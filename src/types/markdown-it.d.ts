declare module "markdown-it/dist/index.cjs.js" {
  export default class MarkdownIt {
    constructor(options?: {
      html?: boolean;
      linkify?: boolean;
      breaks?: boolean;
    });

    renderer: {
      rules: Record<string, (...args: any[]) => string>;
    };

    use(plugin: (...args: any[]) => unknown, ...params: any[]): this;
    render(markdown: string, env?: unknown): string;
  }
}

declare module "markdown-it-texmath" {
  const texmath: (...args: any[]) => unknown;
  export default texmath;
}
