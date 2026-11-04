import { useState } from 'react';

export function ThemeToggle() {
  const [dark,setDark]=useState(()=>localStorage.getItem('hivexui-theme')==='dark');
  document.documentElement.dataset.theme=dark?'dark':'light';
  return <button className="theme-toggle" type="button" aria-label={dark?'Use light theme':'Use dark theme'} onClick={()=>{
    const next=!dark;setDark(next);localStorage.setItem('hivexui-theme',next?'dark':'light');
  }}>{dark?'Light theme':'Dark theme'}</button>;
}
