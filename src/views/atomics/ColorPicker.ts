const ColorPicker = (containerEl: HTMLElement, value: string, onChange: (value: string) => void) => {
	const input = createEl("input", { attr: { type: "color" } });
	input.value = value;
	input.addEventListener("change", () => {
		onChange(input.value);
	});
	containerEl.appendChild(input);
}

export default ColorPicker;
