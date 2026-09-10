import { MousePointer2, CheckSquare, TextCursorInput, Hash, SlidersHorizontal, Image, UserRound, List, TrendingUp, ChartColumn, Table, ChevronsUpDown, ToggleLeft, AlignLeft, PanelTop, Badge, Loader, PanelsTopLeft, AppWindow, CircleDot } from 'lucide-react';
import type { componentNames } from '../shared/design-capabilities';
export const componentIcons: Record<typeof componentNames[number], typeof MousePointer2> = {
  Button: MousePointer2, Checkbox: CheckSquare, Input: TextCursorInput, InputNumber: Hash, Slider: SlidersHorizontal, Image, Avatar: UserRound, List, Statistics: TrendingUp, Chart: ChartColumn, Table, Select: ChevronsUpDown, Switch: ToggleLeft, Textarea: AlignLeft, Card: PanelTop, Badge, Progress: Loader, Tabs: PanelsTopLeft, Dialog: AppWindow, Radio: CircleDot,
};
