import React, { useEffect, useRef } from 'react';
import { Filter, Check, RotateCcw, X } from 'lucide-react';
import { ELEMENT_COLORS, getElementIconUrl } from '../utils/elements';
import { AdvancedFilterState } from '../types';
import { sound } from '../services/sound';

interface AdvancedFilterPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  filters: AdvancedFilterState;
  onChange: (filters: AdvancedFilterState) => void;
  placement?: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left' | 'custom';
  className?: string;
}

export const AdvancedFilterPopover: React.FC<AdvancedFilterPopoverProps> = ({
  isOpen,
  onClose,
  filters,
  onChange,
  placement = 'bottom-right',
  className = '',
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const elementsList = Object.keys(ELEMENT_COLORS);

  const toggleElement = (el: string) => {
    sound.playClick();
    const nextElements = filters.elements.includes(el)
      ? filters.elements.filter((item) => item !== el)
      : [...filters.elements, el];
    onChange({ ...filters, elements: nextElements });
  };

  const toggleSpecialType = (type: 'boss' | 'multiform') => {
    sound.playClick();
    const nextSpecial = filters.specialTypes.includes(type)
      ? filters.specialTypes.filter((item) => item !== type)
      : [...filters.specialTypes, type];
    onChange({ ...filters, specialTypes: nextSpecial });
  };

  const handleReset = () => {
    sound.playToggleOff();
    onChange({ elements: [], specialTypes: [] });
  };

  const activeCount = filters.elements.length + filters.specialTypes.length;

  const placementClasses = {
    'bottom-right': 'absolute right-0 mt-2',
    'bottom-left': 'absolute left-0 mt-2',
    'top-right': 'absolute right-0 bottom-full mb-2',
    'top-left': 'absolute left-0 bottom-full mb-2',
    'custom': '',
  }[placement];

  return (
    <div
      ref={popoverRef}
      className={`${placementClasses} w-72 sm:w-80 bg-white rounded-2xl border-2 border-slate-200 shadow-2xl z-50 p-4 animate-in fade-in zoom-in-95 duration-100 ${className}`}
    >
      <div className="flex items-center justify-between border-b pb-2 mb-3">
        <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-[#2B78C4]" />
          高级筛选
          {activeCount > 0 && (
            <span className="bg-[#2B78C4] text-white text-[10px] font-black px-1.5 py-0.2 rounded-full">
              {activeCount}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <button
              type="button"
              onClick={handleReset}
              className="text-[10px] text-slate-400 hover:text-[#2B78C4] transition-colors flex items-center gap-0.5 font-bold cursor-pointer"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              重置
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Special Types Filters (首领化 / 多形态) */}
        <div>
          <h4 className="text-[11px] font-black text-slate-500 mb-2">类型筛选</h4>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => toggleSpecialType('boss')}
              className={`flex-1 py-1.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1 border-2 cursor-pointer ${
                filters.specialTypes.includes('boss')
                  ? 'bg-rose-50 border-rose-400 text-rose-700 font-black'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              {filters.specialTypes.includes('boss') && <Check className="w-3 h-3 stroke-[3]" />}
              首领化
            </button>
            <button
              type="button"
              onClick={() => toggleSpecialType('multiform')}
              className={`flex-1 py-1.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1 border-2 cursor-pointer ${
                filters.specialTypes.includes('multiform')
                  ? 'bg-amber-50 border-amber-400 text-amber-800 font-black'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800'
              }`}
            >
              {filters.specialTypes.includes('multiform') && <Check className="w-3 h-3 stroke-[3]" />}
              多形态
            </button>
          </div>
        </div>

        {/* Elements Filters (属性) */}
        <div>
          <h4 className="text-[11px] font-black text-slate-500 mb-2">属性筛选</h4>
          <div className="grid grid-cols-4 gap-1.5">
            {elementsList.map((el) => {
              const isActive = filters.elements.includes(el);
              const colorStyle = ELEMENT_COLORS[el];
              return (
                <button
                  key={el}
                  type="button"
                  onClick={() => toggleElement(el)}
                  style={{
                    backgroundColor: isActive ? colorStyle.bg : '#F8FAFC',
                    color: isActive ? (colorStyle.fg || '#FFFFFF') : '#475569',
                    borderColor: isActive ? 'transparent' : '#E2E8F0',
                  }}
                  className={`flex items-center gap-1 px-1.5 py-1 rounded-xl text-[10px] font-black border transition-all cursor-pointer justify-center hover:scale-105 active:scale-95 select-none`}
                >
                  <img
                    src={getElementIconUrl(el)}
                    alt={el}
                    className="w-3 h-3 rounded-full object-contain shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <span>{el}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
