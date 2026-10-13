'use strict';

// Ball events understood by the app. `runs` is what the batting side gets,
// `legal` says whether the delivery counts towards the over.
const EVENTS = {
  dot: { runs: 0, legal: true, wicket: false, desc: 'dot ball, no run' },
  single: { runs: 1, legal: true, wicket: false, desc: 'pushed for a quick single' },
  two: { runs: 2, legal: true, wicket: false, desc: 'driven into the gap, they come back for two' },
  four: { runs: 4, legal: true, wicket: false, desc: 'FOUR! races to the boundary' },
  six: { runs: 6, legal: true, wicket: false, desc: 'SIX! huge hit over the rope' },
  bowled: { runs: 0, legal: true, wicket: true, desc: 'WICKET! clean bowled, stumps shattered' },
  caught: { runs: 0, legal: true, wicket: true, desc: 'WICKET! caught in the deep' },
  lbw: { runs: 0, legal: true, wicket: true, desc: 'WICKET! trapped LBW, finger goes up' },
  wide: { runs: 1, legal: false, wicket: false, desc: 'wide ball, extra run' },
  noball: { runs: 1, legal: false, wicket: false, desc: 'no-ball! free hit coming up' },
  dropped: { runs: 0, legal: true, wicket: false, desc: 'catch DROPPED! a sitter put down, batter survives' },
  free: { runs: 0, legal: false, wicket: false, desc: '' },
};

function isEvent(name) {
  return Object.prototype.hasOwnProperty.call(EVENTS, name);
}

module.exports = { EVENTS, isEvent };
