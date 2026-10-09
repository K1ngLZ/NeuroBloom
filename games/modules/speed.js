import { createAdventure } from './platform.js';
export const metadata = { id:'speed', title:'Rastro Solar', description:'Cruze jardins suspensos e ruínas em três corridas de velocidade, molas e anéis.', controls:[{action:'jump',label:'Pular'},{action:'dash',label:'Turbo'}] };
export function createGame(runtime) { return createAdventure(runtime, true); }
