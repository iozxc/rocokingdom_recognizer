import React from 'react';

/** 捕获渲染期异常，避免整页白屏；显示错误信息便于定位。 */
export class ErrorBoundary extends React.Component {
  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught:', error, info);
  }

  render() {
    // 项目未安装 @types/react，React 被推断为 any；用 any 断言绕过类组件类型推断
    const self = this as any;
    const err: Error | null = self.state?.error ?? null;
    if (err) {
      return (
          <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
            <div className="max-w-lg w-full bg-white rounded-2xl shadow-lg p-6 text-center">
              <h1 className="text-lg font-black text-red-600">界面渲染出错</h1>
              <p className="mt-2 text-sm text-slate-500 break-all">
                {String(err.message || err)}
              </p>
              <button
                  onClick={() => self.setState({ error: null })}
                  className="mt-4 px-4 py-2 rounded-xl bg-sky-500 text-white font-bold hover:bg-sky-600 transition-colors cursor-pointer"
              >
                重试
              </button>
            </div>
          </div>
      );
    }
    return self.props.children;
  }
}
