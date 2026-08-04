/**
 * The build maths, with no Node dependencies.
 *
 * ★ A SUBPATH SO THE BROWSER CAN HAVE IT ★
 *
 * The Shipyard's outfitter recomputes mass, power and jump range the instant a module changes, and
 * that has to happen in the browser — a round trip between picking a power plant and seeing what it
 * did is the one thing an outfitting screen must not have.
 *
 * The package index pulls in the Discord and Inara adapters, which reach for Node built-ins and
 * would fail a web bundle. Everything here is arithmetic over plain objects, so it ships to the
 * client and the SAME implementation computes the numbers on both sides — a second copy in the
 * browser is how a page and its server start disagreeing about a jump range.
 */
export {
  buildCatalogue,
  categoryOf,
  STANDARD_GROUPS,
  type BuildCatalogue,
  type CatalogueModule,
  type CatalogueShip,
  type CatalogueSlot,
  type SlotCategory,
} from './catalogue.js';
export { computeStats, type BuildStats } from './stats.js';
// The outfitter's payload adapter and fact tables — shared by the website and the companion app,
// so the two surfaces cannot disagree about a dropdown's contents or a module's figures.
export {
  catalogueFrom,
  optionsFor,
  slotCategory,
  type OutfitPayload,
  type RawModule,
} from './outfit-payload.js';
export { moduleFacts, moduleDescription, moduleSummary } from './module-facts.js';
export { fitForRole, fitShip, type FitRole, type FitRequest, type FitResult } from './fit.js';
