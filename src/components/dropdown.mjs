import { html, LitElement, render as litRender } from "lit";
import { classMap } from "lit/directives/class-map.js";

/**
 * Abstract class for implementing a custom dropdown element.
 */
export class DropdownElement extends LitElement {

	static properties = {
		_isOpen: { state: true }
	};

	static dropdownClasses = "";

	/** @type {HTMLElement | null} */
	#dropdownContainer = null;

	constructor() {
		super();
		this._isOpen = false;
	}

	render() {
		return html`
			<div
				class=${classMap({ "gaa-dropdown-button": true, "gaa-dropdown-button-open": this._isOpen })}
				@mousedown=${() => this._isOpen = !this._isOpen}
			>
				${this._renderButton()}
				<i class="fas fa-chevron-down"></i>
			</div>
		`;
	}

	/**
	 * Renders the contents of the dropdown button.
	 * @protected
	 * @returns {ReturnType<html>}
	 */
	_renderButton() {
		throw new Error("Must be overriden in a derived subclass.");
	}

	/**
	 * Renders the contents of the dropdown.
	 * @protected
	 * @returns {ReturnType<html>}
	 */
	_renderDropdown() {
		throw new Error("Must be overriden in a derived subclass.");
	}

	#renderDropdownElement() {
		if (!this._isOpen) {
			this.#dropdownContainer?.remove();
			this.#dropdownContainer = null;
			return;
		}

		if (!this.#dropdownContainer) {
			this.#dropdownContainer = document.createElement("div");
			this.#dropdownContainer.classList.add("gaa-dropdown-container", "application", ...this.constructor.dropdownClasses.split(" ").filter(Boolean));
			document.body.appendChild(this.#dropdownContainer);
		}

		litRender(this._renderDropdown(), this.#dropdownContainer);
	}

	#updateDropdownPosition() {
		if (!this.#dropdownContainer) return;

		const { top, left, width, height } = this.getBoundingClientRect();
		const { width: dropdownWidth, height: dropdownHeight } = this.#dropdownContainer.getBoundingClientRect();

		Object.assign(this.#dropdownContainer.style, {
			top: top + height + dropdownHeight > window.innerHeight
				? `${top - dropdownHeight}px`
				: `${top + height}px`,
			left: left + dropdownWidth > window.innerWidth
				? `${left + width - dropdownWidth}px`
				: `${left}px`,
			minWidth: `${width}px`
		});
	}

	connectedCallback() {
		super.connectedCallback();
		document.body.addEventListener("pointerdown", this.#onDocumentPointerDown);
	}

	/** @param {Map<string, any>} changedProperties */
	update(changedProperties) {
		super.update(changedProperties);
		this.#renderDropdownElement();
	}

	updated() {
		// Without this promise, the dropdown does not seem to finish rendering child components properly and so may
		// have an incorrect size.
		Promise.resolve().then(() => this.#updateDropdownPosition());
	}

	disconnectedCallback() {
		super.disconnectedCallback();
		this.#dropdownContainer?.remove();
		document.body.removeEventListener("pointerdown", this.#onDocumentPointerDown);
	}

	/** @param {PointerEvent} e */
	#onDocumentPointerDown = e => {
		if (!this._isOpen) return;

		const isInside = e.target.closest(".gaa-dropdown-container") === this.#dropdownContainer
			|| e.target.closest(this.tagName) === this;

		if (!isInside)
			this._isOpen = false;
	};

	createRenderRoot() {
		return this;
	}
}
