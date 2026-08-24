// SnippetOverlayService — renders 2D snippet cards over the 3D graph canvas.
//
// Each card floats near its node's projected screen position with an SVG line
// connecting card to node. Cards are clamped inside the viewport so they never
// clip out of view. Positions update every rAF tick so they track the node as
// the user rotates/zooms the graph.

import { ForceGraph3DInstance } from '3d-force-graph';
import Graph from 'src/graph/Graph';

export interface SnippetEntry {
	path: string;
	title: string;
	snippet: string;
	color?: string; // cluster color for the accent line/border
}

const CARD_WIDTH = 240;
const CARD_MARGIN = 16;   // min distance from viewport edge
const LINE_OFFSET = 12;   // gap between node sphere and line end

export class SnippetOverlayService {
	private container: HTMLElement;
	private svgEl: SVGSVGElement;
	private cardsEl: HTMLElement;
	private animFrameId: number | null = null;
	private entries: SnippetEntry[] = [];

	constructor(
		private readonly instance: ForceGraph3DInstance,
		private readonly rootEl: HTMLElement,
		private readonly getGraph: () => Graph,
	) {
		this.container = rootEl.createDiv({ cls: 'samind-snippet-overlay' });

		// SVG layer for connector lines (behind cards)
		this.svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
		this.svgEl.classList.add('samind-snippet-svg');
		this.container.appendChild(this.svgEl);

		// Div layer for cards (above SVG)
		this.cardsEl = this.container.createDiv({ cls: 'samind-snippet-cards' });
	}

	public show(entries: SnippetEntry[]): void {
		this.entries = entries;
		this.rebuild();
		if (this.animFrameId === null) {
			this.animFrameId = window.requestAnimationFrame(this.tick);
		}
	}

	public clear(): void {
		this.entries = [];
		this.rebuild();
		if (this.animFrameId !== null) {
			window.cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}
	}

	public destroy(): void {
		this.clear();
		this.container.remove();
	}

	// ── private ──────────────────────────────────────────────────────────────

	private rebuild(): void {
		this.svgEl.innerHTML = '';
		this.cardsEl.innerHTML = '';

		this.entries.forEach((entry, i) => {
			const accent = entry.color ?? 'var(--color-accent)';

			// SVG connector line
			const line = document.createElementNS('http://www.w3.org/2000/svg', 'line') as SVGLineElement;
			line.setAttribute('stroke', accent);
			line.setAttribute('stroke-width', '1.5');
			line.setAttribute('stroke-opacity', '0.7');
			line.setAttribute('stroke-dasharray', '4 3');
			line.dataset.index = String(i);
			this.svgEl.appendChild(line);

			// Card element
			const card = this.cardsEl.createDiv({ cls: 'samind-snippet-card' });
			card.style.setProperty('--snippet-accent', accent);
			card.dataset.index = String(i);

			const titleEl = card.createDiv({ cls: 'samind-snippet-card-title' });
			titleEl.textContent = entry.title;

			const bodyEl = card.createDiv({ cls: 'samind-snippet-card-body' });
			bodyEl.textContent = entry.snippet;
		});
	}

	private readonly tick = () => {
		if (this.entries.length === 0) return;

		const rect = this.rootEl.getBoundingClientRect();
		const W = rect.width;
		const H = rect.height;

		// keep SVG sized to container
		this.svgEl.setAttribute('width', String(W));
		this.svgEl.setAttribute('height', String(H));

		const graph = this.getGraph();

		this.entries.forEach((entry, i) => {
			const node = graph.getNodeById(entry.path);
			const rNode = node as unknown as { x?: number; y?: number; z?: number };
			const card = this.cardsEl.children[i] as HTMLElement | undefined;
			const line = this.svgEl.children[i] as SVGLineElement | undefined;
			if (!card || !line) return;

			if (!rNode?.x || !rNode?.y || !rNode?.z) {
				card.style.opacity = '0';
				line.style.display = 'none';
				return;
			}

			const screen = this.instance.graph2ScreenCoords(rNode.x, rNode.y, rNode.z);
			const nx = screen.x;
			const ny = screen.y;

			// Distribute cards vertically so they don't all stack
			const cardH = card.offsetHeight || 110;
			const spacing = cardH + 12;
			const totalH = this.entries.length * spacing - 12;
			const startY = H / 2 - totalH / 2;
			const idealCardY = startY + i * spacing;

			// Place card on left or right side based on node position
			const onRight = nx < W / 2;
			const cardX = onRight
				? Math.min(nx + 60, W - CARD_WIDTH - CARD_MARGIN)
				: Math.max(nx - 60 - CARD_WIDTH, CARD_MARGIN);
			const cardY = Math.max(CARD_MARGIN, Math.min(idealCardY, H - cardH - CARD_MARGIN));

			card.style.left = cardX + 'px';
			card.style.top = cardY + 'px';
			card.style.opacity = '1';
			line.style.display = '';

			// Line from node sphere edge → card anchor point
			const cardAnchorX = onRight ? cardX : cardX + CARD_WIDTH;
			const cardAnchorY = cardY + cardH / 2;

			// nudge line start off the node sphere
			const dx = cardAnchorX - nx;
			const dy = cardAnchorY - ny;
			const dist = Math.sqrt(dx * dx + dy * dy) || 1;
			const lx1 = nx + (dx / dist) * LINE_OFFSET;
			const ly1 = ny + (dy / dist) * LINE_OFFSET;

			line.setAttribute('x1', String(lx1));
			line.setAttribute('y1', String(ly1));
			line.setAttribute('x2', String(cardAnchorX));
			line.setAttribute('y2', String(cardAnchorY));
		});

		this.animFrameId = window.requestAnimationFrame(this.tick);
	};
}
