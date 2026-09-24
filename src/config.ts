import * as vscode from 'vscode';

export type DisplayMode = 'fold' | 'dim' | 'off';

const cfg = () => vscode.workspace.getConfiguration('notefold');

export const displayMode = (): DisplayMode => cfg().get<DisplayMode>('displayMode', 'fold');
export const gutterBar = (): boolean => cfg().get<boolean>('gutterBar', true);
export const gutterAddButton = (): boolean => cfg().get<boolean>('gutterAddButton', true);
export const showNoteOnLineNumberClick = (): boolean => cfg().get<boolean>('showNoteOnLineNumberClick', true);
export const inlineTitle = (): boolean => cfg().get<boolean>('inlineTitle', true);
export const hideMarkers = (): boolean => cfg().get<boolean>('hideMarkers', true);
