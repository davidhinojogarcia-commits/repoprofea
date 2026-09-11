export type AppToastType='success'|'error';
export type AppToastDetail={message:string;type:AppToastType};

export const APP_TOAST_EVENT='profea:toast';

export function showAppToast(message:string,type:AppToastType='success'){
  if(typeof window==='undefined')return;
  window.dispatchEvent(new CustomEvent<AppToastDetail>(APP_TOAST_EVENT,{detail:{message,type}}));
}
