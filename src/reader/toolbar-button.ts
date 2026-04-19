export function buildAskAIButtonMarkup(): string {
  return `
    <span class="zpr-toolbar-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16" focusable="false">
        <path d="M3 4.5A2.5 2.5 0 0 1 5.5 2h5A2.5 2.5 0 0 1 13 4.5v3A2.5 2.5 0 0 1 10.5 10H8.4l-2.6 2.2c-.32.27-.8.04-.8-.38V10.9A2.45 2.45 0 0 1 3 8.5z"></path>
        <path d="M10.7 3.2l.34 1.03 1.04.33-1.04.34-.34 1.03-.33-1.03-1.04-.34 1.04-.33z"></path>
      </svg>
    </span>
  `.trim();
}

export function ensureAskAIButtonStyles(doc: Document): void {
  if (doc.getElementById("zpr-toolbar-button-style")) {
    return;
  }

  const style = doc.createElement("style");
  style.id = "zpr-toolbar-button-style";
  style.textContent = getAskAIButtonStyles();
  doc.documentElement.appendChild(style);
}

export function getAskAIButtonStyles(): string {
  return `
    #zpr-ask-ai-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 0;
      width: 28px;
      height: 28px;
      border: 1px solid rgba(59, 130, 246, 0.22);
      background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(239,246,255,0.98));
      color: #0f172a;
      font-weight: 600;
      transition: background 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
    }
    #zpr-ask-ai-button:hover {
      background: linear-gradient(180deg, rgba(239,246,255,1), rgba(219,234,254,1));
      border-color: rgba(59, 130, 246, 0.35);
      box-shadow: 0 8px 20px rgba(37, 99, 235, 0.08);
    }
    #zpr-ask-ai-button .zpr-toolbar-icon {
      display: inline-flex;
      width: 16px;
      height: 16px;
      color: #2563eb;
      flex: 0 0 auto;
    }
    #zpr-ask-ai-button .zpr-toolbar-icon svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.3;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    #zpr-ask-ai-button:focus-visible {
      outline: none;
      border-color: rgba(59, 130, 246, 0.45);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
    }
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
