export interface Release {
  version: string;
  changes: readonly string[];
}

export const RELEASES: readonly Release[] = [
  {
    version: "1.1.0",
    changes: [
      "TypePro 新首页：笔记列表、搜索与最近文档。",
      "浅色、深色与跟随系统外观，自定义主题色、字号和正文宽度。",
      "可调整的文档目录、正文左侧嵌套大纲与快速打开。",
      "在光标处使用 / 菜单插入 Markdown 内容。",
      "代码块语言选择、语法高亮、行号与复制。",
      "参考 Typora 的 macOS 快捷键与可搜索的快捷键列表。",
      "六张内置笔记封面、本地图片封面，以及白色圆角底、黑色文档与笔的新版图标。",
    ],
  },
  {
    version: "1.0.0",
    changes: [
      "本地 Markdown 笔记与文档，支持直接编辑、源码和阅读视图。",
      "Apple Silicon Mac 与 Android 应用。",
      "Markdown / ZIP 导入导出与本地附件。",
      "自定义插件的导入、权限确认、启停与卸载。",
    ],
  },
];

export const UPGRADE_NOTES = [
  { title: "更新前", text: "建议先通过“导入 / 导出”导出全部笔记为 ZIP，保留一份备份。" },
  { title: "Mac", text: "退出旧版“笔记”，打开 DMG，将 TypePro 拖入“应用程序”。新版沿用原有数据目录；旧应用名称不同，可能仍会保留，请使用 TypePro 打开笔记。" },
  { title: "Android", text: "使用相同签名与包名的新版 APK 直接覆盖安装。请勿先卸载旧版，卸载会删除应用内的本地数据。" },
  { title: "版本兼容", text: "1.1.0 可以读取旧版笔记。包含封面的新版索引请继续用新版打开，1.0.0 不支持该索引。" },
] as const;
