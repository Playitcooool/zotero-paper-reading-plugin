declare module "markdown-it" {
  export default class MarkdownIt {
    constructor(options?: {
      html?: boolean;
      linkify?: boolean;
      breaks?: boolean;
    });

    renderer: {
      rules: Record<string, (...args: any[]) => string>;
    };

    render(markdown: string, env?: unknown): string;
  }
}
