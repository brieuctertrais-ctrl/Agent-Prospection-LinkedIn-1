/**
 * Centralised LinkedIn DOM selectors.
 *
 * LinkedIn changes its markup often: every element has several CSS candidates
 * (tried in order) and, for buttons, text/aria fallbacks in FR and EN.
 * When a REQUIRED element is not found, the content script reports
 * `ui_changed` and the side panel pauses cleanly instead of guessing.
 *
 * SELECTORS_VERSION is logged with every action to correlate breakages.
 */
export const SELECTORS_VERSION = "2026-11-11";

export interface SelectorDef {
  css: string[];
  /** Case-insensitive texts/aria-labels to match on buttons when CSS fails. */
  texts?: string[];
  required?: boolean;
}

export const SELECTORS = {
  // ---- Profile page ----
  profileName: { css: ["main h1", "h1.text-heading-xlarge", ".pv-text-details__left-panel h1"], required: true },
  profileHeadline: { css: ["main .text-body-medium.break-words", "main [data-generated-suggestion-target]", ".pv-text-details__left-panel .text-body-medium"] },
  profileLocation: { css: ["main .text-body-small.inline.t-black--light.break-words", "main .pv-text-details__left-panel .text-body-small"] },
  profilePhoto: { css: ["main img.pv-top-card-profile-picture__image--show", "main img.pv-top-card-profile-picture__image", "main img.profile-photo-edit__preview", "main .pv-top-card__photo img"] },
  currentCompany: {
    css: [
      "main button[aria-label^='Current company']",
      "main button[aria-label^='Entreprise actuelle']",
      "button[aria-label^='Current company']",
      "button[aria-label^='Entreprise actuelle']",
      "a[aria-label^='Current company']",
      "a[aria-label^='Entreprise actuelle']",
    ],
  },
  topCard: { css: ["main section.artdeco-card:first-of-type", "main .pv-top-card", "main section"], required: true },
  aboutSection: { css: ["section:has(> #about)", "section:has(#about)"] },
  aboutText: { css: [".inline-show-more-text span[aria-hidden='true']", "div.display-flex span[aria-hidden='true']", "span[aria-hidden='true']"] },
  experienceSection: { css: ["section:has(> #experience)", "section:has(#experience)"] },
  experienceItems: { css: ["li.artdeco-list__item", "ul > li"] },
  activitySection: { css: ["section:has(> #content_collections)", "section:has(#content_collections)"] },
  activityItems: { css: [".feed-shared-update-v2__description span[dir='ltr']", ".update-components-text span[dir='ltr']", "li span[dir='ltr']"] },
  distanceBadge: { css: ["main .dist-value", "main .distance-badge .dist-value"] },

  // ---- Connection flow ----
  connectButton: {
    css: ["main button[aria-label$='to connect']", "main button[aria-label*='rejoindre votre réseau']", "main button[aria-label*='to connect']"],
    texts: ["Se connecter", "Connect"],
  },
  moreButton: {
    css: ["main button[aria-label='More actions']", "main button[aria-label='Plus d’actions']", "main button[aria-label=\"Plus d'actions\"]"],
    texts: ["Plus", "More"],
  },
  dropdownConnect: {
    css: [".artdeco-dropdown__content div[role='button'][aria-label*='to connect']", ".artdeco-dropdown__content div[role='button'][aria-label*='rejoindre votre réseau']"],
    texts: ["Se connecter", "Connect"],
  },
  pendingButton: {
    css: ["main button[aria-label*='Pending']", "main button[aria-label*='En attente']", "main button[aria-label*='Withdraw invitation']", "main button[aria-label*='Retirer l’invitation']"],
    texts: ["En attente", "Pending"],
  },
  dialog: { css: ["div[role='dialog']", ".artdeco-modal"] },
  addNoteButton: {
    css: ["div[role='dialog'] button[aria-label='Add a note']", "div[role='dialog'] button[aria-label='Ajouter une note']"],
    texts: ["Ajouter une note", "Add a note"],
  },
  noteTextarea: { css: ["div[role='dialog'] textarea[name='message']", "div[role='dialog'] textarea#custom-message", "div[role='dialog'] textarea"] },
  sendButton: {
    css: [
      "div[role='dialog'] button[aria-label='Send invitation']",
      "div[role='dialog'] button[aria-label='Envoyer l’invitation']",
      "div[role='dialog'] button[aria-label=\"Envoyer l'invitation\"]",
      "div[role='dialog'] button[aria-label='Send now']",
      "div[role='dialog'] button[aria-label='Envoyer maintenant']",
    ],
    texts: ["Envoyer", "Send"],
  },

  // ---- Search results ----
  searchResultLinks: { css: ["main .reusable-search__result-container a[href*='/in/']", "main li a[href*='/in/']", "main a[href*='/in/']"] },
} satisfies Record<string, SelectorDef>;

export type SelectorKey = keyof typeof SELECTORS;

/** Texts LinkedIn shows when it limits or challenges the account. */
export const WARNING_PATTERNS = {
  weeklyLimit: [/weekly invitation limit/i, /limite hebdomadaire/i, /reached the weekly limit/i, /atteint la limite/i],
  noteLimit: [/personali[sz]ed invitations/i, /invitations personnalisées/i],
  securityCheck: [/security verification/i, /vérification de sécurité/i, /let's do a quick security check/i, /captcha/i],
  restricted: [/account (has been )?restricted/i, /compte (a été )?restreint/i],
};
