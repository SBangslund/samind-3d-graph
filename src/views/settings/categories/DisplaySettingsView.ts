import { Setting } from "obsidian";
import { DisplaySettings } from "../../../settings/categories/DisplaySettings";
import SimpleSliderSetting, {
	DEFAULT_SLIDER_STEP_OPTIONS,
	SliderOptions,
} from "../../atomics/SimpleSliderSetting";
import State from "../../../util/State";

const DisplaySettingsView = (
	displaySettings: State<DisplaySettings>,
	containerEl: HTMLElement
) => {
	NodeSizeSetting(displaySettings, containerEl);
	LinkThicknessSetting(displaySettings, containerEl);
	ParticleSizeSetting(displaySettings, containerEl);
	ParticleCountSetting(displaySettings, containerEl);
	ClusterShapeSetting(displaySettings, containerEl);
};

const NodeSizeSetting = (
	displaySettings: State<DisplaySettings>,
	containerEl: HTMLElement
) => {
	const options: SliderOptions = {
		name: "Node Size",
		value: displaySettings.value.nodeSize,
		stepOptions: DEFAULT_SLIDER_STEP_OPTIONS,
	};
	return SimpleSliderSetting(containerEl, options, (value) => {
		displaySettings.value.nodeSize = value;
	});
};

const LinkThicknessSetting = (
	displaySettings: State<DisplaySettings>,
	containerEl: HTMLElement
) => {
	const options: SliderOptions = {
		name: "Link Thickness",
		value: displaySettings.value.linkThickness,
		stepOptions: DEFAULT_SLIDER_STEP_OPTIONS,
	};
	return SimpleSliderSetting(containerEl, options, (value) => {
		displaySettings.value.linkThickness = value;
	});
};

const ParticleSizeSetting = (
	displaySettings: State<DisplaySettings>,
	containerEl: HTMLElement
) => {
	const options: SliderOptions = {
		name: "Particle Size",
		value: displaySettings.value.particleSize,
		stepOptions: DEFAULT_SLIDER_STEP_OPTIONS,
	};
	return SimpleSliderSetting(containerEl, options, (value) => {
		displaySettings.value.particleSize = value;
	});
};

const ParticleCountSetting = (
	displaySettings: State<DisplaySettings>,
	containerEl: HTMLElement
) => {
	const options: SliderOptions = {
		name: "Particle Count",
		value: displaySettings.value.particleCount,
		stepOptions: DEFAULT_SLIDER_STEP_OPTIONS,
	};
	return SimpleSliderSetting(containerEl, options, (value) => {
		displaySettings.value.particleCount = value;
	});
};

const ClusterShapeSetting = (
	displaySettings: State<DisplaySettings>,
	containerEl: HTMLElement
) => {
	new Setting(containerEl)
		.setName("Cluster Shape")
		.setDesc("Shape used to draw cluster boundaries")
		.addDropdown((dropdown) => {
			dropdown
				.addOption('convex', 'Convex Hull')
				.addOption('box', 'Box')
				.setValue(displaySettings.value.clusterShape)
				.onChange((value) => {
					displaySettings.value.clusterShape = value as 'box' | 'convex';
				});
		});
};

export default DisplaySettingsView;
