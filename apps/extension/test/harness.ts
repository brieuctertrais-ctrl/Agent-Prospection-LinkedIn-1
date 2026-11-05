// Exposes the content-script logic on window for the DOM fixture test.
import { scrapeProfile, scrapeSearchResults } from "../src/linkedin/scraper";
import { sendInvitation } from "../src/linkedin/invite";
import { scrapeConnections, scrapeInbox, sendMessage } from "../src/linkedin/messaging";
import { findCompanyUrl, scrapeCompany } from "../src/linkedin/company";
(window as unknown as Record<string, unknown>).kairo = { scrapeProfile, scrapeSearchResults, sendInvitation, sendMessage, scrapeConnections, scrapeInbox, findCompanyUrl, scrapeCompany };
