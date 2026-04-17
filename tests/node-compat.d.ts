declare module "node:test" {
  const test: (name: string, fn: () => void | Promise<void>) => void;
  export default test;
}

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    match(actual: string, expected: RegExp, message?: string): void;
    doesNotMatch(actual: string, expected: RegExp, message?: string): void;
    rejects(block: Promise<unknown> | (() => Promise<unknown>), error?: RegExp | object): Promise<void>;
  };
  export default assert;
}

declare module "node:fs" {
  export function readFileSync(path: URL | string, encoding: string): string;
}
