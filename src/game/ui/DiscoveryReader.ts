import type { DiscoveryText } from "../content/discoveries";
import type { FinderCopy, LocaleId } from "../i18n";

interface ReaderOptions {
  id: string;
  locale: LocaleId;
  content: DiscoveryText;
  copy: FinderCopy;
  onClose: () => void;
  onRestart: () => void;
  onLobby: () => void;
  backLabel?: string;
  onOther?: () => void;
  onAction?: () => void;
  onDone?: () => void;
  actionDone?: boolean;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

/** Optional reading UI only. No read receipts, progress writes or game rules. */
export class DiscoveryReader {
  readonly discoveryId: string;
  private readonly dialog = element("dialog", "discovery-reader");
  private readonly events = new AbortController();

  constructor(options: ReaderOptions) {
    const { content, copy } = options;
    this.discoveryId = options.id;
    this.dialog.dataset.testid = "discovery-reader";
    this.dialog.dataset.discoveryId = options.id;
    this.dialog.lang = options.locale;
    this.dialog.setAttribute("aria-labelledby", "discovery-title");

    const header = element("header", "discovery-header");
    header.append(element("p", "discovery-eyebrow", copy.discovery.heading));
    const title = element("h1", "discovery-title", content.title);
    title.id = "discovery-title";
    title.dataset.testid = "discovery-title";
    title.tabIndex = -1;
    header.append(title, element("p", "discovery-topic", content.topic));
    if (options.onOther) {
      const other = element("button", "discovery-button discovery-other", copy.full.otherDiscovery);
      other.dataset.testid = "reader-other";
      other.addEventListener("click", options.onOther, { signal: this.events.signal });
      header.append(other);
    }

    // The middle region scrolls independently, so editing the prose never
    // pushes navigation off screen. Plain text keeps content edits literal.
    const scroll = element("div", "discovery-scroll");
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-labelledby", title.id);
    const body = element("article", "discovery-story");
    body.dataset.testid = "discovery-body";
    for (const paragraph of content.paragraphs) body.append(element("p", "", paragraph));
    const quote = element("div", "discovery-quote");
    const line = element("blockquote", "", content.finderLine);
    line.dataset.testid = "discovery-finder-line";
    quote.append(element("p", "discovery-label", copy.discovery.finderSays), line);
    body.append(quote);
    const suggestion = element("aside", "discovery-suggestion");
    const suggestionText = element("p", "", content.suggestion);
    suggestionText.dataset.testid = "discovery-suggestion";
    suggestion.append(
      element("h2", "", copy.discovery.optionalAction),
      suggestionText,
      element("p", "discovery-optional-hint", copy.discovery.optionalHint),
    );
    if (options.onAction) {
      suggestionText.hidden = true;
      const action = element("button", "discovery-button", copy.full.action);
      action.dataset.testid = "reader-action";
      const done = element("button", "discovery-button", options.actionDone ? copy.full.actionDone : copy.full.done);
      done.dataset.testid = "reader-action-done";
      done.hidden = true;
      done.disabled = !!options.actionDone;
      action.addEventListener("click", () => {
        options.onAction?.();
        suggestionText.hidden = false;
        action.hidden = true;
        done.hidden = !options.onDone;
      }, { signal: this.events.signal });
      done.addEventListener("click", () => {
        options.onDone?.(); done.textContent = copy.full.actionDone; done.disabled = true;
      }, { signal: this.events.signal });
      suggestion.insertBefore(action, suggestionText);
      suggestion.append(done);
    }
    scroll.append(body, suggestion);

    const footer = element("footer", "discovery-actions");
    const actions = [
      { id: "close-discovery", label: options.backLabel ?? copy.discovery.backToResult, action: options.onClose, primary: true },
      { id: "discovery-restart", label: copy.result.retry, action: options.onRestart, primary: false },
      { id: "discovery-lobby", label: copy.result.lobby, action: options.onLobby, primary: false },
    ];
    for (const action of actions) {
      const button = element("button", action.primary ? "discovery-button primary" : "discovery-button", action.label);
      button.type = "button";
      button.dataset.testid = action.id;
      button.addEventListener("click", action.action, { signal: this.events.signal });
      footer.append(button);
    }
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      options.onClose();
    }, { signal: this.events.signal });
    this.dialog.append(header, scroll, footer);
    document.body.append(this.dialog);
    document.body.classList.add("discovery-open");
    this.dialog.showModal();
    title.focus({ preventScroll: true });
  }

  destroy(): void {
    this.events.abort();
    this.dialog.close();
    this.dialog.remove();
    document.body.classList.remove("discovery-open");
  }
}
