import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Person } from '../types';
import { PersonCard } from './PersonCard';
import { ArrowUp, Zap } from 'lucide-react';

interface VirtualPersonListProps {
  people: Person[];
  selectedIds: number[];
  onToggleSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onEdit: (person: Person) => void;
  onGenerateIDCard: (person: Person) => void;
  onExportHistoryPDF: (person: Person) => void;
  onOpenCalendar: (person: Person) => void;
  isSyncActive?: boolean;
  onToggleSync?: (id: number) => void;
  sameDniWorkersMap: Map<string, Person[]>;
  estimatedItemHeight?: number;
  overscan?: number;
}

export const VirtualPersonList: React.FC<VirtualPersonListProps> = ({
  people,
  selectedIds,
  onToggleSelect,
  onDelete,
  onEdit,
  onGenerateIDCard,
  onExportHistoryPDF,
  onOpenCalendar,
  isSyncActive = false,
  onToggleSync,
  sameDniWorkersMap,
  estimatedItemHeight = 260,
  overscan = 4
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(750);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Dynamic height measurements cache: itemId -> height in px
  const itemHeightsRef = useRef<Map<number, number>>(new Map());
  const [, forceUpdate] = useState({});

  // Reset or adjust measurements when people list structure fundamentally changes
  useEffect(() => {
    // If container exists, ensure viewport height is accurate
    if (containerRef.current) {
      setViewportHeight(containerRef.current.clientHeight || 750);
    }
  }, [people]);

  // ResizeObserver for dynamic viewport height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) {
          setViewportHeight(entry.contentRect.height);
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Handle scroll events with requestAnimationFrame for 60fps/120fps fluidity
  const rafIdRef = useRef<number | null>(null);
  const handleScroll = useCallback(() => {
    if (rafIdRef.current !== null) return;

    rafIdRef.current = requestAnimationFrame(() => {
      if (containerRef.current) {
        const top = containerRef.current.scrollTop;
        setScrollTop(top);
        setShowScrollTop(top > 400);
      }
      rafIdRef.current = null;
    });
  }, []);

  // Measure rendered items and update heights
  const measureItem = useCallback((id: number, node: HTMLDivElement | null) => {
    if (!node) return;
    const measuredHeight = node.getBoundingClientRect().height;
    if (measuredHeight > 0 && itemHeightsRef.current.get(id) !== measuredHeight) {
      itemHeightsRef.current.set(id, measuredHeight);
      // Trigger smooth update if measurement differed significantly
      forceUpdate({});
    }
  }, []);

  // Compute item offsets and total virtual height
  const { offsets, totalHeight } = useMemo(() => {
    const offsetsArr: number[] = new Array(people.length);
    let currentOffset = 0;
    const gap = 16; // 16px vertical gap between cards

    for (let i = 0; i < people.length; i++) {
      offsetsArr[i] = currentOffset;
      const height = itemHeightsRef.current.get(people[i].id) || estimatedItemHeight;
      currentOffset += height + gap;
    }

    return {
      offsets: offsetsArr,
      totalHeight: Math.max(0, currentOffset - (people.length > 0 ? gap : 0))
    };
  }, [people, estimatedItemHeight]);

  // Calculate visible range based on scrollTop and viewportHeight
  const { startIndex, endIndex } = useMemo(() => {
    if (people.length === 0) {
      return { startIndex: 0, endIndex: 0 };
    }

    // Binary search for startIndex
    let low = 0;
    let high = people.length - 1;
    let start = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const offset = offsets[mid];
      const itemHeight = itemHeightsRef.current.get(people[mid].id) || estimatedItemHeight;

      if (offset + itemHeight >= scrollTop) {
        start = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    // Find endIndex
    let end = start;
    const viewBottom = scrollTop + viewportHeight;

    while (end < people.length && offsets[end] < viewBottom) {
      end++;
    }

    // Apply overscan buffer
    const boundedStart = Math.max(0, start - overscan);
    const boundedEnd = Math.min(people.length - 1, end + overscan);

    return {
      startIndex: boundedStart,
      endIndex: boundedEnd
    };
  }, [people.length, offsets, scrollTop, viewportHeight, overscan, estimatedItemHeight]);

  // Visible items slice to render
  const visibleItems = useMemo(() => {
    if (people.length === 0) return [];
    return people.slice(startIndex, endIndex + 1).map((person, idx) => {
      const actualIndex = startIndex + idx;
      return {
        person,
        index: actualIndex,
        topOffset: offsets[actualIndex] || 0
      };
    });
  }, [people, startIndex, endIndex, offsets]);

  const scrollToTop = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Selected set for O(1) lookup
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <div className="relative">
      {/* Virtualization Efficiency Info Bar */}
      <div className="flex items-center justify-between px-2 pb-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5 font-medium">
          <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
          <span>
            Mostrando {people.length} trabajador{people.length !== 1 ? 'es' : ''} (Virtualización activa: {visibleItems.length} en DOM)
          </span>
        </span>
        {people.length > 50 && (
          <span className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 px-2 py-0.5 rounded-full font-bold">
            Scroll Ultra Fluido
          </span>
        )}
      </div>

      {/* Virtual Scroll Container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        id="virtual-person-list-container"
        className="max-h-[760px] overflow-y-auto pr-2 custom-scrollbar relative will-change-scroll focus:outline-none"
        tabIndex={0}
        aria-label="Listado de trabajadores virtualizado"
      >
        {/* Virtual spacer with exact total height */}
        <div
          style={{ height: `${totalHeight}px`, position: 'relative', width: '100%' }}
          className="min-h-[100px]"
        >
          {visibleItems.map(({ person, index, topOffset }) => {
            const cleanDni = person.dni ? person.dni.trim().toUpperCase().replace(/[\s-]/g, '') : '';
            const sameDniWorkers = cleanDni && sameDniWorkersMap.has(cleanDni) 
              ? sameDniWorkersMap.get(cleanDni)! 
              : [];

            return (
              <div
                key={`virtual_person_${person.id}_${index}`}
                ref={(node) => measureItem(person.id, node)}
                style={{
                  position: 'absolute',
                  top: `${topOffset}px`,
                  left: 0,
                  right: 0,
                  width: '100%'
                }}
              >
                <PersonCard
                  person={person}
                  isSelected={selectedSet.has(person.id)}
                  onToggleSelect={onToggleSelect}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onGenerateIDCard={onGenerateIDCard}
                  onExportHistoryPDF={onExportHistoryPDF}
                  onOpenCalendar={onOpenCalendar}
                  isSyncActive={isSyncActive}
                  onToggleSync={onToggleSync}
                  sameDniWorkers={sameDniWorkers}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating Scroll-to-Top Button */}
      {showScrollTop && (
        <button
          type="button"
          onClick={scrollToTop}
          id="btn-scroll-to-top"
          className="absolute bottom-4 right-6 p-3 bg-[#00548E] hover:bg-[#003e6b] text-white rounded-full shadow-lg hover:shadow-xl transition-all z-20 cursor-pointer flex items-center justify-center animate-in fade-in zoom-in-95 duration-200"
          title="Volver arriba"
          aria-label="Volver arriba de la lista"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};
