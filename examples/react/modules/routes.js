/*
 * Copyright 2017 The boardgame.io Authors.
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import tic_tac_toe from './tic-tac-toe';
import chess from './chess';
import phases from './phases';
import liars_dice from './liars-dice';
import random from './random';
import turnorder from './turnorder';
import ui from './ui';

const routes = [
  {
    name: 'Tic-Tac-Toe',
    routes: tic_tac_toe.routes,
  },
  {
    name: 'Chess',
    routes: chess.routes,
  },
  {
    name: 'Phases',
    routes: phases.routes,
  },
  {
    name: 'Liars Dice',
    routes: liars_dice.routes,
  },
  {
    name: 'Random API',
    routes: random.routes,
  },
  {
    name: 'Events API',
    routes: turnorder.routes,
  },
  {
    name: 'UI',
    routes: ui.routes,
  },
];

export default routes;
