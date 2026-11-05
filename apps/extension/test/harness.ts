// Exposes the content-script logic on window for the DOM fixture test.
import { scrapeProfile, scrapeSearchResults } from "../src/linkedin/scraper";
import { sendInvitation } from "../src/linkedin/invite";
import { scrapeConnections, sendMessage } from "../src/linkedin/messaging";
(window as unknown as Record<string, unknown>).kairo = { scrapeProfile, scrapeSearchResults, sendInvitation, sendMessage, scrapeConnections };
