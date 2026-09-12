import { Brand } from './ui';
import { ThemeToggle } from './theme-toggle';
import { useCommunityEnabled } from './community-client';

export function PublicNavigation({ active }: { active: 'guide' | 'docs' | 'community' }) {
  const communityEnabled = useCommunityEnabled();
  return <header className="main-header public-header"><a className="brand-link" href="/" aria-label="Design Studio AI home"><Brand /></a>
    <nav aria-label="Main navigation">{[['/', 'Workspace'], ['/templates', 'Templates'], ['/design-systems', 'Design systems'], ...(communityEnabled ? [['/community', 'Community']] : []), ['/activity', 'Activity'], ['/docs', 'Documentation'], ['/guide', 'Guide']].map(([href, label]) => <a key={href} href={href} aria-current={href === `/${active}` ? 'page' : undefined}>{label}</a>)}</nav>
    <div className="header-end"><ThemeToggle /></div>
  </header>;
}
