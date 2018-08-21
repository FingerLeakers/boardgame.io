/*
 * Copyright 2017 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

const Koa = require('koa');
const IO = require('koa-socket-2');
const Redux = require('redux');

import { DBFromEnv } from './db';
import { CreateGameReducer } from '../core/reducer';
import { MAKE_MOVE, GAME_EVENT } from '../core/action-types';
import { createApiServer, isActionFromAuthenticPlayer } from './api';

const PING_TIMEOUT = 20 * 1e3;
const PING_INTERVAL = 10 * 1e3;

function GameMaster(game, db, clients) {
  const onUpdate = async (action, stateID, gameID, playerID) => {
    let state = await db.get(gameID);

    if (state === undefined) {
      return { error: 'game not found' };
    }

    const reducer = CreateGameReducer({
      game,
      numPlayers: state.ctx.numPlayers,
    });
    const store = Redux.createStore(reducer, state);

    const isActionAuthentic = await isActionFromAuthenticPlayer({
      action,
      db,
      gameID,
      playerID,
    });
    if (!isActionAuthentic) {
      return { error: 'unauthorized action' };
    }

    // Check whether the player is allowed to make the move.
    if (
      action.type == MAKE_MOVE &&
      !game.flow.canPlayerMakeMove(state.G, state.ctx, playerID)
    ) {
      return;
    }

    // Check whether the player is allowed to call the event.
    if (
      action.type == GAME_EVENT &&
      !game.flow.canPlayerCallEvent(state.G, state.ctx, playerID)
    ) {
      return;
    }

    if (state._stateID == stateID) {
      let log = store.getState().log || [];

      // Update server's version of the store.
      store.dispatch(action);
      state = store.getState();

      // Get clients connected to this current game.
      for (const playerID of clients.getClients()) {
        const filteredState = {
          ...state,
          G: game.playerView(state.G, state.ctx, playerID),
          ctx: { ...state.ctx, _random: undefined },
          log: undefined,
          deltalog: undefined,
        };

        clients.sendUpdate(gameID, playerID, [
          gameID,
          filteredState,
          state.deltalog,
        ]);
      }

      // TODO: We currently attach the log back into the state
      // object before storing it, but this should probably
      // sit in a different part of the database eventually.
      log = [...log, ...state.deltalog];
      const stateWithLog = { ...state, log };

      await db.set(gameID, stateWithLog);
    }

    return;
  };

  const onSync = async (gameID, playerID, numPlayers) => {
    const reducer = CreateGameReducer({ game, numPlayers });
    let state = await db.get(gameID);

    if (state === undefined) {
      const store = Redux.createStore(reducer);
      state = store.getState();
      await db.set(gameID, state);
    }

    const filteredState = {
      ...state,
      G: game.playerView(state.G, state.ctx, playerID),
      ctx: { ...state.ctx, _random: undefined },
      log: undefined,
      deltalog: undefined,
    };

    clients.sendSync(gameID, playerID, [gameID, filteredState, state.log]);

    return;
  };

  return {
    onUpdate,
    onSync,
  };
}

function SocketInterface(_clientInfo, _roomInfo) {
  const clientInfo = _clientInfo || new Map();
  const roomInfo = _roomInfo || new Map();

  return {
    init: (app, games) => {
      const io = new IO({
        ioOptions: {
          pingTimeout: PING_TIMEOUT,
          pingInterval: PING_INTERVAL,
        },
      });

      app.context.io = io;
      io.attach(app);

      for (const game of games) {
        const nsp = app._io.of(game.name);

        const obj = {
          getClients: gameID => {
            return roomInfo
              .get(gameID)
              .values()
              .map(c => clientInfo.get(c).playerID);
          },

          sendUpdate: (gameID, playerID, args) => {
            const clients = roomInfo.get(gameID).values();
            for (const client of clients) {
              const info = clientInfo.get(client);
              if (info.playerID == playerID) {
                info.socket.emit.apply(null, ['update', ...args]);
              } else {
                info.socket
                  .to(info.socket.id)
                  .emit.apply(null, ['update', ...args]);
              }
            }
          },

          sendSync: (gameID, playerID, args) => {
            const clients = roomInfo.get(gameID);
            for (const client of clients.values()) {
              const info = clientInfo.get(client);
              if (info.playerID == playerID) {
                info.socket.emit.apply(null, ['update', ...args]);
              } else {
                info.socket
                  .to(info.socket.id)
                  .emit.apply(null, ['update', ...args]);
              }
            }
          },
        };

        const master = new GameMaster(game, app.context.db, obj);

        nsp.on('connection', socket => {
          socket.on('update', async (action, stateID, gameID, playerID) => {
            await master.onUpdate(action, stateID, gameID, playerID);
          });

          socket.on('sync', async (gameID, playerID, numPlayers) => {
            socket.join(gameID);

            let roomClients = roomInfo.get(gameID);
            if (roomClients === undefined) {
              roomClients = new Set();
              roomInfo.set(gameID, roomClients);
            }
            roomClients.add(socket.id);

            clientInfo.set(socket.id, { gameID, playerID, socket });
            await master.onSync(gameID, playerID, numPlayers);
          });

          socket.on('disconnect', () => {
            if (clientInfo.has(socket.id)) {
              const { gameID } = clientInfo.get(socket.id);
              roomInfo.get(gameID).delete(socket.id);
              clientInfo.delete(socket.id);
            }
          });
        });
      }
    },
  };
}

export function Server({ games, db, clientInterface, _clientInfo, _roomInfo }) {
  const app = new Koa();

  if (db === undefined) {
    db = DBFromEnv();
  }
  app.context.db = db;

  if (clientInterface === undefined) {
    clientInterface = SocketInterface(_clientInfo, _roomInfo);
  }
  clientInterface.init(app, games);

  const api = createApiServer({ db, games });

  return {
    app,
    api,
    db,
    run: async (port, callback) => {
      await db.connect();
      await api.listen(port + 1);
      await app.listen(port, callback);
    },
  };
}
