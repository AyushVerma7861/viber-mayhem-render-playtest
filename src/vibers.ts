import viber10 from './assets/vibers/viber-10.png?inline';
import viber31 from './assets/vibers/viber-31.png?inline';
import viber84 from './assets/vibers/viber-84.png?inline';
import agent123 from './assets/vibers/agent-123.png?inline';

export const VIBERS = [
  { name: 'Viber 10', id: 'viber-10', color: '#73d6b6', portrait: viber10 },
  { name: 'Viber 31', id: 'viber-31', color: '#ff845f', portrait: viber31 },
  { name: 'Viber 84', id: 'viber-84', color: '#f4c87e', portrait: viber84 },
  { name: 'Agent 123', id: 'agent-123', color: '#c5b0ff', portrait: agent123 },
] as const;

export type Viber = typeof VIBERS[number];

export function viberParty(selected: Viber): readonly Viber[] {
  return [selected, ...VIBERS.filter(viber => viber !== selected)];
}
