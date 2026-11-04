import { useEffect, useState, type AnchorHTMLAttributes } from 'react';
export function refreshSecurity():void {window.dispatchEvent(new Event('security-refresh'));}
export function usePathname():string {
  const [path,setPath]=useState(location.pathname);
  useEffect(()=>{const update=()=>setPath(location.pathname);window.addEventListener('popstate',update);return()=>window.removeEventListener('popstate',update);},[]);
  return path;
}
function push(path:string):void {
  if(!path.startsWith('/security-fusion') || path.startsWith('//'))throw new Error('Invalid security route');
  history.pushState(null,'',path);window.dispatchEvent(new PopStateEvent('popstate'));
}
export function useRouter(){return {push,refresh:refreshSecurity};}
export function notFound():never {throw new Error('This security record is unavailable');}
export default function Link({href,onClick,prefetch:_prefetch,...props}:AnchorHTMLAttributes<HTMLAnchorElement>&{prefetch?:boolean}) {
  return <a {...props} href={href} onClick={event=>{
    onClick?.(event);
    if(event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !href?.startsWith('/security-fusion'))return;
    event.preventDefault();push(href);
  }}/>;
}
