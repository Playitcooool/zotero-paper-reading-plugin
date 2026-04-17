import type { SectionId } from "../background/types.ts";

export type SupportedLocale = "zh-CN" | "en-US";

export interface PluginStrings {
  appName: string;
  toolbar: {
    askAI: string;
  };
  panel: {
    title: string;
    inReaderSubtitle: string;
    fallbackSubtitle: string;
    loading: string;
    emptyTitle: string;
    emptyBody: string;
    untitledPaper: string;
    evidenceReferences: string;
    analysisFailed: string;
    retry: string;
    generatedAtLabel: string;
    copy: string;
    copied: string;
    refreshingSaved: string;
    showingSavedFallback: string;
    composerPlaceholder: string;
    send: string;
    thinking: string;
    transcriptCopy: string;
    emptyChatTitle: string;
    emptyChatBody: string;
    roleUser: string;
    roleAssistant: string;
    startNewReading: string;
    regenerate: string;
    clear: string;
    copyMessage: string;
    retryTurn: string;
    close: string;
    jumpToLatest: string;
    requestTimedOut: string;
    saveFailedNotice: string;
    clearConfirm: string;
    regenerateConfirm: string;
    suggestedQuestions: string[];
  };
  settings: {
    subtitle: string;
    languageExperienceTitle: string;
    languageExperienceBody: string;
    backendModeTitle: string;
    directProviderLabel: string;
    credentialsTitle: string;
    apiAddressLabel: string;
    apiAddressHelp: string;
    apiKeyLabel: string;
    apiKeyHelp: string;
    modelNameLabel: string;
    modelNameHelp: string;
    advancedTitle: string;
    advancedToggleShow: string;
    advancedToggleHide: string;
    requestTimeoutLabel: string;
    requestTimeoutHelp: string;
    sidebarWidthLabel: string;
    sidebarWidthHelp: string;
    save: string;
    reset: string;
    saved: string;
    resetDone: string;
    invalidNumericReset: string;
    modeSummaryTitle: string;
    directModeSummary: string;
  };
  backends: {
    openaiCompatible: string;
    anthropic: string;
    google: string;
  };
  sections: Record<SectionId, string>;
}

const ZH_CN: PluginStrings = {
  appName: "Zotero Paper Reading",
  toolbar: {
    askAI: "Ask AI"
  },
  panel: {
    title: "Ask AI",
    inReaderSubtitle: "当前论文聊天",
    fallbackSubtitle: "当前论文聊天",
    loading: "正在生成精炼论文解读…",
    emptyTitle: "还没有解读结果",
    emptyBody: "点击 Ask AI 开始生成当前论文的精炼解读。",
    untitledPaper: "未命名论文",
    evidenceReferences: "证据引用",
    analysisFailed: "解读失败",
    retry: "重试",
    generatedAtLabel: "生成于",
    copy: "复制全文",
    copied: "已复制到剪贴板",
    refreshingSaved: "已显示上次结果，正在刷新本次解读。",
    showingSavedFallback: "本次解读失败，当前显示的是上次保存的结果。",
    composerPlaceholder: "继续追问这篇论文...",
    send: "发送",
    thinking: "正在思考...",
    transcriptCopy: "复制会话",
    emptyChatTitle: "开始提问",
    emptyChatBody: "右侧会先生成一版精炼解读，之后你可以继续追问实现、实验设计或方法细节。",
    roleUser: "你",
    roleAssistant: "AI",
    startNewReading: "开始新解读",
    regenerate: "重新生成",
    clear: "清空会话",
    copyMessage: "复制本条",
    retryTurn: "重试这一轮",
    close: "关闭面板",
    jumpToLatest: "跳到最新内容",
    requestTimedOut: "请求在 {ms} 毫秒后超时，请重试。",
    saveFailedNotice: "内容已生成，但自动保存失败。",
    clearConfirm: "这会删除当前论文已保存的聊天记录。确定继续吗？",
    regenerateConfirm: "这会丢弃当前会话并重新生成首条论文解读。确定继续吗？",
    suggestedQuestions: [
      "这篇论文最核心的贡献是什么？",
      "哪些部分最值得迁移到实现中？",
      "这篇论文的主要局限和开放问题是什么？"
    ]
  },
  settings: {
    subtitle: "为 Zotero PDF 阅读器提供可继续追问的论文聊天侧栏，并自动保存当前会话。",
    languageExperienceTitle: "语言与体验",
    languageExperienceBody: "界面和解读语言会自动跟随 Zotero 当前语言，在中文和英文之间切换。",
    backendModeTitle: "Provider 与凭据",
    directProviderLabel: "Provider",
    credentialsTitle: "连接与凭据",
    apiAddressLabel: "API 地址",
    apiAddressHelp: "填写当前 provider 的 API 地址，本地或远程部署都适用。",
    apiKeyLabel: "API Key",
    apiKeyHelp: "如果服务无需密钥，可以留空。",
    modelNameLabel: "模型名称",
    modelNameHelp: "建议使用支持长上下文和文档理解的模型。",
    advancedTitle: "高级设置",
    advancedToggleShow: "显示高级设置",
    advancedToggleHide: "隐藏高级设置",
    requestTimeoutLabel: "请求超时（毫秒）",
    requestTimeoutHelp: "文档较长时可适当提高，默认 120000。",
    sidebarWidthLabel: "侧栏宽度",
    sidebarWidthHelp: "控制右侧聊天面板宽度，默认 420。",
    save: "保存设置",
    reset: "恢复默认",
    saved: "已保存",
    resetDone: "已恢复默认值",
    invalidNumericReset: "部分数值无效，已自动恢复为安全默认值。",
    modeSummaryTitle: "当前连接建议",
    directModeSummary: "通常只需要选择 provider，填写 API 地址、API Key 和模型名称即可开始使用。"
  },
  backends: {
    openaiCompatible: "OpenAI Compatible",
    anthropic: "Anthropic",
    google: "Google Gemini"
  },
  sections: {
    thesis: "论文主旨",
    "core-method": "核心方法",
    "reusable-ideas": "可复用思路",
    "implementation-transfer": "落地实现建议",
    "related-work": "相关工作定位",
    evidence: "证据引用",
    "open-questions": "待解问题",
    "follow-up": "后续实验与扩展方向"
  }
};

const EN_US: PluginStrings = {
  appName: "Zotero Paper Reading",
  toolbar: {
    askAI: "Ask AI"
  },
  panel: {
    title: "Ask AI",
    inReaderSubtitle: "Current paper chat",
    fallbackSubtitle: "Current paper chat",
    loading: "Generating a concise paper reading...",
    emptyTitle: "No reading yet",
    emptyBody: "Click Ask AI to generate a concise first reading of this paper.",
    untitledPaper: "Untitled Paper",
    evidenceReferences: "Evidence references",
    analysisFailed: "Analysis failed",
    retry: "Retry",
    generatedAtLabel: "Generated",
    copy: "Copy analysis",
    copied: "Copied to clipboard",
    refreshingSaved: "Showing the last saved analysis while refreshing.",
    showingSavedFallback: "The refresh failed. Showing the last saved analysis instead.",
    composerPlaceholder: "Ask a follow-up about this paper...",
    send: "Send",
    thinking: "Thinking...",
    transcriptCopy: "Copy chat",
    emptyChatTitle: "Ask about this paper",
    emptyChatBody: "The sidebar starts with a concise first reading, then you can continue with follow-up questions about methods, experiments, or implementation details.",
    roleUser: "You",
    roleAssistant: "AI",
    startNewReading: "Start new reading",
    regenerate: "Regenerate",
    clear: "Clear chat",
    copyMessage: "Copy message",
    retryTurn: "Retry turn",
    close: "Close panel",
    jumpToLatest: "Jump to latest",
    requestTimedOut: "Request timed out after {ms} ms. Please try again.",
    saveFailedNotice: "Content was generated, but auto-save failed.",
    clearConfirm: "This will delete the saved chat for this paper. Continue?",
    regenerateConfirm: "This will discard the current chat and regenerate the first paper reading. Continue?",
    suggestedQuestions: [
      "What is the core contribution of this paper?",
      "What parts are most reusable for implementation?",
      "What are the main limitations or open questions?"
    ]
  },
  settings: {
    subtitle: "Open a follow-up-friendly paper chat sidebar for Zotero PDFs and save the current session automatically.",
    languageExperienceTitle: "Language & experience",
    languageExperienceBody: "The interface and analysis language follow the current Zotero language automatically.",
    backendModeTitle: "Provider & credentials",
    directProviderLabel: "Provider",
    credentialsTitle: "Connection & credentials",
    apiAddressLabel: "API address",
    apiAddressHelp: "Enter the current provider API address. This works for both local and remote deployments.",
    apiKeyLabel: "API key",
    apiKeyHelp: "Leave empty if your endpoint does not require authentication.",
    modelNameLabel: "Model name",
    modelNameHelp: "Prefer a model with strong long-context document understanding.",
    advancedTitle: "Advanced settings",
    advancedToggleShow: "Show advanced settings",
    advancedToggleHide: "Hide advanced settings",
    requestTimeoutLabel: "Request timeout (ms)",
    requestTimeoutHelp: "Increase this for longer papers. Default is 120000.",
    sidebarWidthLabel: "Sidebar width",
    sidebarWidthHelp: "Controls the width of the right-side chat panel. Default is 420.",
    save: "Save settings",
    reset: "Reset to defaults",
    saved: "Saved",
    resetDone: "Reset to defaults",
    invalidNumericReset: "Some invalid numeric values were reset to safe defaults.",
    modeSummaryTitle: "Current connection guidance",
    directModeSummary: "You usually only need the provider, API address, API key, and model name before you start."
  },
  backends: {
    openaiCompatible: "OpenAI Compatible",
    anthropic: "Anthropic",
    google: "Google Gemini"
  },
  sections: {
    thesis: "Thesis",
    "core-method": "Core method/mechanism",
    "reusable-ideas": "Reusable ideas",
    "implementation-transfer": "Implementation transfer",
    "related-work": "Related-work positioning",
    evidence: "Evidence references",
    "open-questions": "Open questions",
    "follow-up": "Follow-up experiments/build directions"
  }
};

export function getResolvedLocale(localeLike?: string | null): SupportedLocale {
  const value = (localeLike || "").toLowerCase();
  return value.startsWith("zh") ? "zh-CN" : "en-US";
}

export function getCurrentLocale(): SupportedLocale {
  const locale = (globalThis as { Zotero?: { locale?: string } }).Zotero?.locale;
  return getResolvedLocale(locale);
}

export function getStringsForLocale(locale: SupportedLocale): PluginStrings {
  return locale === "zh-CN" ? ZH_CN : EN_US;
}

export function getCurrentStrings(): PluginStrings {
  return getStringsForLocale(getCurrentLocale());
}

export function localizeSectionTitle(id: SectionId, locale: SupportedLocale): string {
  return getStringsForLocale(locale).sections[id];
}
