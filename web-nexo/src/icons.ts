const paths={
 close:'M6 6l12 12M18 6 6 18',back:'m14 5-7 7 7 7',next:'m10 5 7 7-7 7',
 external:'M7 17 17 7M7 7h10v10',chat:'M20 4H4v13h4v4l5-4h7Z',
 send:'m4 4 17 8-17 8 3-8Zm3 8h14',person:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
 flip:'M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4',restart:'M20 7v6h-6M20 13a8 8 0 1 0-2 5',
 flag:'M5 21V3m0 1h6l2 3h6v9h-6l-2-3H5',pause:'M9 5v14M15 5v14',play:'m8 4 12 8-12 8Z',
 minus:'M5 12h14',plus:'M5 12h14M12 5v14',expand:'M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6',
 home:'m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7',history:'M5 5h14M5 10h14M5 15h14M5 20h9',
} as const;
export type IconName=keyof typeof paths;
/** Decorative SVG; the surrounding control owns the localized accessible name. */
export function icon(name:IconName){return `<svg class="ui-icon" data-icon="${name}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${paths[name]}"/></svg>`}
