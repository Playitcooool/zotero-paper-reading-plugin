# Zotero Paper Reading Plugin

A Zotero 7+ plugin that adds an `Ask AI` workflow directly to the PDF reader.

When a paper is open, the plugin injects an `Ask AI` button into the reader toolbar. Clicking it opens a dedicated chat sidebar on the right, keeps the PDF visible on the left, generates a detailed first-pass reading for the paper, and then lets the user continue with follow-up questions in the same session.

## Features

- Adds an `Ask AI` button to the Zotero PDF reader toolbar.
- Opens a dedicated right-side paper chat panel without replacing the PDF view.
- Generates the first paper reading automatically, then supports follow-up chat.
- Renders model output as Markdown with headings, lists, quotes, and code fences.
- Turns citations such as `[Fig. 2]`, `[Table 1]`, and `[p. 5]` into clickable references when a page mapping is available.
- Saves the chat transcript as a plugin-managed Zotero child note for the attachment.
- Localizes the interface and default response language for Chinese and English Zotero environments.
- Supports direct model calls and a local companion service mode.

## Compatibility

- Zotero `7.0+`
- Add-on manifest currently allows Zotero versions up to `9.9.9`

## Backend Modes

### Direct mode

The plugin can call a model endpoint directly from Zotero. Current provider options are:

- OpenAI-compatible endpoints
- Anthropic
- Google Gemini API

Typical direct-mode fields:

- API address
- API key
- Model name
- Request timeout

### Companion mode

The plugin can also forward chat requests to a local companion service. In this mode, the plugin sends requests to:

`<companion-url>/chat`

Typical companion-mode fields:

- Companion URL
- Request timeout

## Installation

### Build from source

```bash
npm install
npm run build
```

The packaged add-on will be generated at:

`build/zotero-paper-reading.xpi`

### Install in Zotero

1. Open Zotero.
2. Go to `Tools -> Plugins` or the Add-ons manager in your Zotero build.
3. Choose `Install Add-on From File...`.
4. Select `build/zotero-paper-reading.xpi`.
5. Restart Zotero if required.

## Usage

1. Open a PDF attachment in Zotero's reader.
2. Click `Ask AI` in the reader toolbar.
3. Wait for the initial paper reading to appear in the right-side panel.
4. Continue asking follow-up questions in the chat box.
5. Click figure or page citations in the answer to jump back to the source context when available.

## Preferences

The plugin registers its own Zotero preferences pane. You can configure:

- Backend mode
- Provider selection for direct mode
- API address
- API key
- Model name
- Companion URL
- Request timeout
- Sidebar width

## Development

```bash
npm test
./node_modules/.bin/tsc --noEmit
npm run build
```

For iterative development:

```bash
npm run watch
```

## Notes

- The plugin depends on Zotero attachment text. If a PDF has no extracted text yet, reindex the attachment in Zotero and try again.
- The repository does not currently include a hosted companion server. Companion mode expects an already running local service that implements the `/chat` endpoint.
- The build output and `node_modules` are intentionally excluded from version control.
