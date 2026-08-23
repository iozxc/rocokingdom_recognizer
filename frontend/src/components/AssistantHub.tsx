import React from 'react';
import { Leaf } from 'lucide-react';

interface AssistantHubProps {
  onSelectAssistant: (id: string) => void;
}

// 助手卡片列表：以后火系徽章试炼等新功能在这里追加卡片即可
const ASSISTANTS = [
  {
    id: 'grass',
    title: '草系徽章试炼',
    subtitle: '洛克王国草系徽章识别助手',
    image: './tag_1.png',
  },
];

export const AssistantHub: React.FC<AssistantHubProps> = ({ onSelectAssistant }) => {
  return (
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-12 pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 max-w-3xl mx-auto">
          {ASSISTANTS.map((a) => (
              <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelectAssistant(a.id)}
                  className="group relative overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm hover:border-[#7ABCF4] hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 cursor-pointer text-left"
                  title="点击进入"
              >
                <div className="relative w-full aspect-[16/10] bg-gradient-to-br from-[#7ABCF4] to-[#2B78C4] flex items-center justify-center">
                  <Leaf className="w-10 h-10 text-white/70" />
                  <img
                      src={a.image}
                      alt={a.title}
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                  />
                </div>
                <div className="p-3.5">
                  <div className="text-sm font-black text-slate-800">{a.title}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{a.subtitle}</div>
                </div>
              </button>
          ))}
        </div>
      </main>
  );
};
