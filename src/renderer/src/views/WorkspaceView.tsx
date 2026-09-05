// WorkspaceView（§2.2）：双栏工作台；<960px 树折叠为抽屉
import { useEffect, useState } from 'react'
import { Drawer, Grid } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import TopBar from '../components/TopBar'
import PlanTreePanel from '../components/PlanTreePanel'
import ContentArea from '../components/ContentArea'
import StatusBar from '../components/StatusBar'

function useNarrow(): boolean {
  const screens = Grid.useBreakpoint()
  // lg 断点 992px；规范锚点 960px——取两者交集近似（xl=1200 之下且 lg 不成立时为窄）
  return screens.lg === false
}

export default function WorkspaceView(): React.JSX.Element {
  const narrow = useNarrow()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isClient, setIsClient] = useState(false)
  useEffect(() => setIsClient(true), [])

  const tree = <PlanTreePanel />

  return (
    <div className="ws">
      <TopBar />
      {narrow ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', padding: 8 }}>
          {isClient && (
            <button
              type="button"
              aria-label="打开计划树"
              onClick={() => setDrawerOpen(true)}
              style={{ border: '1px solid var(--split)', borderRadius: 6, padding: '6px 10px', background: '#fff' }}
            >
              <MenuOutlined /> 计划树
            </button>
          )}
          <Drawer title="计划树" placement="left" width={300} open={drawerOpen} onClose={() => setDrawerOpen(false)}>
            {tree}
          </Drawer>
        </div>
      ) : (
        <div className="ws-main">
          <div className="ws-tree">{tree}</div>
          <ContentArea />
        </div>
      )}
      <StatusBar />
    </div>
  )
}
