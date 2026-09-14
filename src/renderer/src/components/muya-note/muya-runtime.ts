import {
  CodeBlockLanguageSelector,
  EmojiSelector,
  FootnoteTool,
  ImageEditTool,
  ImagePathPicker,
  ImageResizeBar,
  ImageToolBar,
  InlineFormatToolbar,
  LinkTools,
  Muya,
  ParagraphFrontButton,
  ParagraphFrontMenu,
  ParagraphQuickInsertMenu,
  PreviewToolBar,
  TableChessboard,
  TableColumnToolbar,
  TableDragBar,
  TableRowColumMenu
} from '@muyajs/core'

export interface MuyaPluginCallbacks {
  openLink?: (href: string) => void
  pickImage?: () => Promise<string>
  persistImage?: (image: { src: string; alt: string; title: string }) => Promise<string>
}

let pluginsRegistered = false

function openBrowserLink(href: string): void {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return

  const openedWindow = window.open(url.toString(), '_blank', 'noopener,noreferrer')
  if (openedWindow) openedWindow.opener = null
}

export function registerMuyaPlugins(callbacks: MuyaPluginCallbacks = {}): void {
  if (pluginsRegistered) return
  pluginsRegistered = true

  const openLink = callbacks.openLink ?? openBrowserLink
  const pickImage = callbacks.pickImage ?? (async () => '')
  const persistImage = callbacks.persistImage ?? (async ({ src }) => src)

  Muya.use(TableChessboard)
  Muya.use(ParagraphQuickInsertMenu)
  Muya.use(CodeBlockLanguageSelector)
  Muya.use(EmojiSelector)
  Muya.use(ImagePathPicker)
  Muya.use(ImageEditTool, {
    imagePathPicker: pickImage,
    imagePathAutoComplete: async () => [],
    imageAction: persistImage
  })
  Muya.use(ImageResizeBar)
  Muya.use(ImageToolBar)
  Muya.use(InlineFormatToolbar)
  Muya.use(ParagraphFrontButton)
  Muya.use(ParagraphFrontMenu)
  Muya.use(PreviewToolBar)
  Muya.use(LinkTools, {
    jumpClick: (linkInfo: { href?: string | null } | null) => {
      if (linkInfo?.href) openLink(linkInfo.href)
    }
  })
  Muya.use(FootnoteTool)
  Muya.use(TableColumnToolbar)
  Muya.use(TableDragBar)
  Muya.use(TableRowColumMenu)
}
