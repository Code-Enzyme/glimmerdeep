import ch1 from './ch1.js';
import ch2 from './ch2.js';
import ch3 from './ch3.js';
import ch4 from './ch4.js';

export const CHAPTERS = [
  { id: 1, name: 'Mossmouth', species: 'M', accent: '#5FBFA8', levels: ch1 },
  { id: 2, name: 'Whelk Grottos', species: 'S', accent: '#E8866A', levels: ch2 },
  { id: 3, name: 'Stumpwood', species: 'T', accent: '#B5D46A', levels: ch3 },
  { id: 4, name: 'Newt Flats', species: 'D', accent: '#A9B6FF', levels: ch4 },
];

export const LEVELS = CHAPTERS.flatMap((c) => c.levels);
