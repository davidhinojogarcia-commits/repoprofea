import React from 'react';

export type DirectoryStatusValue = 'todos' | 'apto' | 'limitaciones' | 'no_apto' | 'pendiente';

type Props = { value: DirectoryStatusValue; onChange: (value: DirectoryStatusValue) => void; counts: Record<DirectoryStatusValue, number> };

export const DirectoryStatusFilter: React.FC<Props> = ({ value, onChange, counts }) => {
  const options: Array<[DirectoryStatusValue, string]> = [['todos','Todos'],['apto','Aptos'],['limitaciones','Con limitaciones'],['no_apto','No aptos'],['pendiente','Pendientes']];
  return <div className="ui-surface px-4 py-3 flex flex-wrap items-center gap-2"><span className="text-sm font-black mr-2">Aptitud</span>{options.map(([option,label]) => <button key={option} type="button" onClick={() => onChange(option)} className={value === option ? 'px-3 py-1.5 rounded-lg text-xs font-bold border bg-[#00548E] text-white' : 'px-3 py-1.5 rounded-lg text-xs font-bold border'}>{label} ({counts[option]})</button>)}</div>;
};
