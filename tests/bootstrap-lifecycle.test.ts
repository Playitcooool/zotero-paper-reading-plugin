import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadBootstrapSandbox(): Record<string, any> {
  const source = readFileSync(new URL("../addon/bootstrap.js", import.meta.url), "utf8");
  const sandbox: Record<string, any> = {
    APP_SHUTDOWN: 5,
    Zotero: {
      ZoteroPaperReading: {
        hooks: {
          onShutdownCalled: 0,
          onShutdown() {
            this.onShutdownCalled += 1;
          }
        }
      },
      log() {}
    },
    Services: {
      obs: {
        removed: [] as Array<{ observer: unknown; topic: string }>,
        removeObserver(observer: unknown, topic: string) {
          this.removed.push({ observer, topic });
        }
      }
    },
    Components: {
      interfaces: {
        nsIStringBundleService: Symbol("nsIStringBundleService")
      }
    },
    Cc: {
      "@mozilla.org/intl/stringbundle;1": {
        getService() {
          return {
            flushed: false,
            flushBundles() {
              this.flushed = true;
            }
          };
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  vm.runInContext(
    `
      chromeHandle = {
        destructCalled: 0,
        destruct() {
          this.destructCalled += 1;
        }
      };
      windowObserver = { name: "observer" };
    `,
    sandbox
  );
  return sandbox;
}

test("bootstrap shutdown cleans up plugin resources outside app shutdown", () => {
  const sandbox = loadBootstrapSandbox();
  const hooks = sandbox.Zotero.ZoteroPaperReading.hooks;

  sandbox.shutdown({}, 0);

  assert.equal(hooks.onShutdownCalled, 1);
  assert.equal(sandbox.Services.obs.removed.length, 1);
  assert.equal(sandbox.Services.obs.removed[0].topic, "domwindowopened");
  assert.equal(sandbox.Services.obs.removed[0].observer.name, "observer");
  assert.equal(vm.runInContext("chromeHandle", sandbox), null);
  assert.equal(vm.runInContext("windowObserver", sandbox), null);
  assert.equal(sandbox.Zotero.ZoteroPaperReading, undefined);
});

test("bootstrap shutdown skips cleanup during app shutdown", () => {
  const sandbox = loadBootstrapSandbox();

  sandbox.shutdown({}, sandbox.APP_SHUTDOWN);

  assert.equal(sandbox.Zotero.ZoteroPaperReading.hooks.onShutdownCalled, 0);
  assert.deepEqual(sandbox.Services.obs.removed, []);
  assert.notEqual(vm.runInContext("chromeHandle", sandbox), null);
  assert.notEqual(vm.runInContext("windowObserver", sandbox), null);
});
