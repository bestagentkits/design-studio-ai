import { kinds } from './schema';
export const communityKinds = kinds;
export const communityCategories = kinds.map((id, i) => ({ id, label: ['Website', 'Presentation', 'Document', 'Wireframe', '3D scene', 'Motion'][i] }));
export const communityLicense = { id: 'CC-BY-4.0', name: 'Creative Commons Attribution 4.0 International', url: 'https://creativecommons.org/licenses/by/4.0/' } as const;
export const communityMilestones = [10, 50, 100] as const;
