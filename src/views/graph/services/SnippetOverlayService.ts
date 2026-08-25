// SnippetOverlayService — renders 2D snippet cards over the 3D graph canvas.
//
// Each card floats near its node's projected screen position with an SVG line
// connecting card to node. Cards are clamped inside the viewport so they never
// clip out of view. Positions update every rAF tick so they track the node as
// the user rotates/zooms the graph.
//
// Cards use Obsidian's MarkdownRenderer so [[wikilinks]] render as clickable
// links with hover-preview support.

import { ForceGraph3DInstance } from '3d-force-graph';
import { App, Component, MarkdownRenderer } from 'obsidian';
import Graph from 'src/graph/Graph';

export interface SnippetEntry {
	path: string;
	title: string;
	snippet: string;
	color?: string; // cluster color for the accent line/border
}

const CARD_WIDTH = 280;
const CARD_MARGIN = 16;   // min distance from viewport edge
const LINE_OFFSET = 14;   // gap between node sphere and line end

export class SnippetOverlayService {
	private container: HTMLElement;
	private backdrop: HTMLElement;
	private svgEl: SVGSVGElement;
	private cardsEl: HTMLElement;
	private animFrameId: number | null = null;
	private entries: SnippetEntry[] = [];
	// MarkdownRenderer child components — must be unloaded when cards are cleared
	private renderComponents: Component[] = [];

	constructor(
		private readonly instance: ForceGraph3DInstance,
		private readonly rootEl: HTMLElement,
		private readonly getGraph: () => Graph,
		private readonly app: App,
		private readonly parentComponent: Component,
	) {
		// Backdrop — dims the graph when snippets are visible
		this.backdrop = rootEl.createDiv({ cls: 'samind-snippet-backdrop' });

		this.container = rootEl.createDiv({ cls: 'samind-snippet-overlay' });

		// SVG layer for connector lines (behind cards)
		this.svgEl = this.container.createSvg('svg', { cls: 'samind-snippet-svg' });

		// Div layer for cards (above SVG)
		this.cardsEl = this.container.createDiv({ cls: 'samind-snippet-cards' });
	}

	public show(entries: SnippetEntry[]): void {
		this.entries = entries;
		this.rebuild();
		this.backdrop.classList.add('is-active');
		if (this.animFrameId === null) {
			this.animFrameId = window.requestAnimationFrame(this.tick);
		}
	}

	public clear(): void {
		this.entries = [];
		this.rebuild();
		this.backdrop.classList.remove('is-active');
		if (this.animFrameId !== null) {
			window.cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}
	}

	public destroy(): void {
		this.clear();
		this.backdrop.remove();
		this.container.remove();
	}

	// ── private ──────────────────────────────────────────────────────────────

	private rebuild(): void {
		// Unload any previous render children to avoid leaks
		this.renderComponents.forEach((c) => c.unload());
		this.renderComponents = [];
		this.svgEl.innerHTML = '';
		this.cardsEl.innerHTML = '';

		this.entries.forEach((entry, i) => {
			const accent = entry.color ?? 'var(--color-accent)';

			// SVG connector line
			const line = this.svgEl.createSvg('line');
			line.setAttribute('stroke', accent);
			line.setAttribute('stroke-width', '1.5');
			line.setAttribute('stroke-opacity', '0.75');
			line.setAttribute('stroke-dasharray', '5 3');
			line.dataset.index = String(i);

			// Card element
			const card = this.cardsEl.createDiv({ cls: 'samind-snippet-card' });
			card.setCssProps({ '--snippet-accent': accent });
			card.dataset.index = String(i);

			const titleEl = card.createDiv({ cls: 'samind-snippet-card-title' });
			titleEl.textContent = entry.title;

			const bodyEl = card.createDiv({ cls: 'samind-snippet-card-body' });

			// Render with MarkdownRenderer so [[wikilinks]] become clickable
			// links with Obsidian hover-preview support
			const child = new Component();
			this.parentComponent.addChild(child);
			this.renderComponents.push(child);
			child.load();

			MarkdownRenderer.render(
				this.app,
				entry.snippet,
				bodyEl,
				entry.path,
				child,
			).then(() => {
				// Wire up hover-preview on all internal links in the card
				bodyEl.querySelectorAll('a.internal-link').forEach((a) => {
					a.addEventListener('mouseover', (e) => {
						this.app.workspace.trigger('hover-link', {
							event: e,
							source: 'samind-graph-snippets',
							hoverParent: { hoverPopover: null },
							targetEl: a,
							linktext: (a as HTMLAnchorElement).getAttribute('data-href') ?? (a as HTMLAnchorElement).textContent ?? '',
							sourcePath: entry.path,
						});
					});
				});
			}).catch(() => {
				bodyEl.textContent = entry.snippet;
			});
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

			if (rNode?.x == null || rNode?.y == null || rNode?.z == null) {
				card.setCssStyles({ opacity: '0' });
				line.setCssStyles({ display: 'none' });
				return;
			}

			const screen = this.instance.graph2ScreenCoords(rNode.x, rNode.y, rNode.z);
			const nx = screen.x;
			const ny = screen.y;

			// Distribute cards vertically, centred in viewport
			const cardH = card.offsetHeight || 130;
			const spacing = cardH + 14;
			const totalH = this.entries.length * spacing - 14;
			const startY = H / 2 - totalH / 2;
			const idealCardY = startY + i * spacing;

			// Place card on whichever side has more space from the node
			const spaceRight = W - nx;
			const onRight = spaceRight >= nx;
			const cardX = onRight
				? Math.min(nx + 70, W - CARD_WIDTH - CARD_MARGIN)
				: Math.max(nx - 70 - CARD_WIDTH, CARD_MARGIN);
			const cardY = Math.max(CARD_MARGIN, Math.min(idealCardY, H - cardH - CARD_MARGIN));

			card.setCssStyles({
				left: cardX + 'px',
				top: cardY + 'px',
				opacity: '1',
			});
			line.setCssStyles({ display: '' });

			// Line from node sphere edge → card anchor point
			const cardAnchorX = onRight ? cardX : cardX + CARD_WIDTH;
			const cardAnchorY = cardY + cardH / 2;

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
