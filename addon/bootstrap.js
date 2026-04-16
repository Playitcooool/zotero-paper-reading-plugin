var chromeHandle;
var windowObserver;

function install() {}

async function startup({ resourceURI, rootURI }, reason) {
  await Zotero.initializationPromise;

  if (!rootURI) {
    rootURI = resourceURI.spec;
  }

  var aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "chrome/content/"]
  ]);

  const ctx = {
    rootURI,
    _globalThis: globalThis
  };
  globalThis.rootURI = rootURI;

  Services.scriptloader.loadSubScript(
    `${rootURI}chrome/content/scripts/__addonRef__.js`,
    ctx
  );

  if (Zotero.ZoteroPaperReading?.hooks?.onStartup) {
    await Zotero.ZoteroPaperReading.hooks.onStartup();
  }

  const wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
    .getService(Components.interfaces.nsIWindowMediator);
  const mainWindow = wm.getMostRecentWindow("navigator:browser");
  if (mainWindow) {
    Zotero.ZoteroPaperReading?.hooks?.onMainWindowLoad?.(mainWindow);
  }

  windowObserver = {
    observe(subject, topic) {
      if (topic !== "domwindowopened") {
        return;
      }

      const win = subject;
      win.addEventListener("load", function () {
        const url = win.location?.href || "";
        if (url.includes("zotero") && !url.includes("devtools") && !url.includes("preferences")) {
          Zotero.ZoteroPaperReading?.hooks?.onMainWindowLoad?.(win);
        }
      }, { once: true });
    }
  };
  Services.obs.addObserver(windowObserver, "domwindowopened", false);
}

async function onMainWindowLoad({ window }) {
  Zotero.ZoteroPaperReading?.hooks?.onMainWindowLoad?.(window);
}

async function onMainWindowUnload({ window }) {
  Zotero.ZoteroPaperReading?.hooks?.onMainWindowUnload?.(window);
}

function shutdown() {
  if (typeof APP_SHUTDOWN !== "undefined" && APP_SHUTDOWN) {
    return;
  }

  Zotero.ZoteroPaperReading?.hooks?.onShutdown?.();

  if (windowObserver) {
    Services.obs.removeObserver(windowObserver, "domwindowopened");
    windowObserver = null;
  }

  Cc["@mozilla.org/intl/stringbundle;1"]
    .getService(Components.interfaces.nsIStringBundleService)
    .flushBundles();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall() {}
