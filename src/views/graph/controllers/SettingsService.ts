import { StateChange } from "src/util/State";
import { AbstractGraphService } from "./AbstractGraphService";

export class SettingsService extends AbstractGraphService {
	public onSettingsStateChanged(data: StateChange) {
		if (data.currentPath === "display.nodeSize") {
			this.instance.nodeRelSize(data.newValue);
		} else if (data.currentPath === "display.linkWidth") {
			this.instance.linkWidth(data.newValue);
		} else if (data.currentPath === "display.particleSize") {
			this.instance.linkDirectionalParticleWidth(
				this.plugin.getSettings().display.particleSize
			);
		}

		this.instance.refresh(); // other settings only need a refresh
	};
}