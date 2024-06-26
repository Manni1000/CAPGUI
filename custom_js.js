function gradioApp() {
	const elems = document.getElementsByTagName('gradio-app');
	const elem = elems.length == 0 ? document : elems[0];

	if (elem !== document) {
		elem.getElementById = function(id) {
			return document.getElementById(id);
		};
	}
	return elem.shadowRoot ? elem.shadowRoot : elem;
}

function get_uiCurrentTab() {
	return gradioApp().querySelector('.tabs > .tab-nav > button.selected');
}

function get_tab_window() {
	return gradioApp().querySelector('.tabs > .tabitem[id^=tab_]:not([style*="display: none"])');
}

document.addEventListener('keydown', function(e) {
	const isEnter = e.key === 'Enter' || e.keyCode === 13;
	const isCtrlKey = e.metaKey || e.ctrlKey;
	const isAltKey = e.altKey;
	const isEsc = e.key === 'Escape';
	
	const generateButton = get_tab_window().querySelector('#promptbar > #buttons > button[id^=generate_]');
	if (isCtrlKey && isEnter) {
		e.preventDefault();
		generateButton.click();
	}
})

// Hacky generate forever function
function gen_forever() {
	const generateButton = get_tab_window().querySelector('#promptbar > #buttons > button[id^=generate_]');
	var generateForever = get_tab_window().querySelector('#promptbar > #buttons > div [id^=gen_forever_] > label > input[type="checkbox"]');
	// console.log(generateForever.checked)
	if (generateForever.checked) {
		generateButton.click();
	}
}
setInterval(gen_forever, 2000);

// Simulate an `input` DOM event for Gradio Textbox component. Needed after you edit its contents in javascript, otherwise your edits
// will only visible on web page and not sent to python.
function updateInput(target) {
	let e = new Event("input", {bubbles: true});
	Object.defineProperty(e, "target", {value: target});
	target.dispatchEvent(e);
}

// TODO: Figure out how to set this from Gradio that doesn't involve json memery
let char_delims = ".,/!?%^*;:{}=`~() ";
let precision_delta = 0.05;

function keyupEditAttention(event) {
	let target = event.originalTarget || event.composedPath()[0];
	if (!target.matches("*:is([id='promptbar'] [id*='_prompt'], .prompt) textarea")) return;
	if (!(event.metaKey || event.ctrlKey)) return;

	let isPlus = event.key == "ArrowUp";
	let isMinus = event.key == "ArrowDown";
	if (!isPlus && !isMinus) return;

	let selectionStart = target.selectionStart;
	let selectionEnd = target.selectionEnd;
	let text = target.value;

	function selectCurrentParenthesisBlock(OPEN, CLOSE) {
		if (selectionStart !== selectionEnd) return false;

		// Find opening parenthesis around current cursor
		const before = text.substring(0, selectionStart);
		let beforeParen = before.lastIndexOf(OPEN);
		if (beforeParen == -1) return false;

		let beforeClosingParen = before.lastIndexOf(CLOSE);
		if (beforeClosingParen != -1 && beforeClosingParen > beforeParen) return false;

		// Find closing parenthesis around current cursor
		const after = text.substring(selectionStart);
		let afterParen = after.indexOf(CLOSE);
		if (afterParen == -1) return false;

		let afterOpeningParen = after.indexOf(OPEN);
		if (afterOpeningParen != -1 && afterOpeningParen < afterParen) return false;

		// Set the selection to the text between the parenthesis
		const parenContent = text.substring(beforeParen + 1, selectionStart + afterParen);
		if (/.*:-?[\d.]+/s.test(parenContent)) {
			const lastColon = parenContent.lastIndexOf(":");
			selectionStart = beforeParen + 1;
			selectionEnd = selectionStart + lastColon;
		} else {
			selectionStart = beforeParen + 1;
			selectionEnd = selectionStart + parenContent.length;
		}

		target.setSelectionRange(selectionStart, selectionEnd);
		return true;
	}

	function selectCurrentWord() {
		if (selectionStart !== selectionEnd) return false;
		const whitespace_delimiters = {"Tab": "\t", "Carriage Return": "\r", "Line Feed": "\n"};
		let delimiters = char_delims;

		// seek backward to find beginning
		while (!delimiters.includes(text[selectionStart - 1]) && selectionStart > 0) {
			selectionStart--;
		}

		// seek forward to find end
		while (!delimiters.includes(text[selectionEnd]) && selectionEnd < text.length) {
			selectionEnd++;
		}

		// deselect surrounding whitespace
		while (text[selectionStart] == " " && selectionStart < selectionEnd) {
			selectionStart++;
		}
		while (text[selectionEnd - 1] == " " && selectionEnd > selectionStart) {
			selectionEnd--;
		}

		target.setSelectionRange(selectionStart, selectionEnd);
		return true;
	}

	// If the user hasn't selected anything, let's select their current parenthesis block or word
	if (!selectCurrentParenthesisBlock('<', '>') && !selectCurrentParenthesisBlock('(', ')') && !selectCurrentParenthesisBlock('[', ']')) {
		selectCurrentWord();
	}

	event.preventDefault();

	var closeCharacter = ')';
	var delta = precision_delta;
	var start = selectionStart > 0 ? text[selectionStart - 1] : "";
	var end = text[selectionEnd];

	if (start == '<') {
		closeCharacter = '>';
		delta = precision_delta;
	} else if (start == '(' && end == ')' || start == '[' && end == ']') { // convert old-style (((emphasis)))
		let numParen = 0;

		while (text[selectionStart - numParen - 1] == start && text[selectionEnd + numParen] == end) {
			numParen++;
		}

		if (start == "[") {
			weight = (1 / 1.1) ** numParen;
		} else {
			weight = 1.1 ** numParen;
		}

		weight = Math.round(weight / precision_delta) * precision_delta;

		text = text.slice(0, selectionStart - numParen) + "(" + text.slice(selectionStart, selectionEnd) + ":" + weight + ")" + text.slice(selectionEnd + numParen);
		selectionStart -= numParen - 1;
		selectionEnd -= numParen - 1;
	} else if (start != '(') {
		// do not include spaces at the end
		while (selectionEnd > selectionStart && text[selectionEnd - 1] == ' ') {
			selectionEnd--;
		}

		if (selectionStart == selectionEnd) {
			return;
		}

		text = text.slice(0, selectionStart) + "(" + text.slice(selectionStart, selectionEnd) + ":1.0)" + text.slice(selectionEnd);

		selectionStart++;
		selectionEnd++;
	}

	if (text[selectionEnd] != ':') return;
	var weightLength = text.slice(selectionEnd + 1).indexOf(closeCharacter) + 1;
	var weight = parseFloat(text.slice(selectionEnd + 1, selectionEnd + weightLength));
	if (isNaN(weight)) return;

	weight += isPlus ? delta : -delta;
	weight = parseFloat(weight.toPrecision(12));
	if (Number.isInteger(weight)) weight += ".0";

	if (closeCharacter == ')' && weight == 1) {
		var endParenPos = text.substring(selectionEnd).indexOf(')');
		text = text.slice(0, selectionStart - 1) + text.slice(selectionStart, selectionEnd) + text.slice(selectionEnd + endParenPos + 1);
		selectionStart--;
		selectionEnd--;
	} else {
		text = text.slice(0, selectionEnd + 1) + weight + text.slice(selectionEnd + weightLength);
	}

	target.focus();
	target.value = text;
	target.selectionStart = selectionStart;
	target.selectionEnd = selectionEnd;

	updateInput(target);
}

addEventListener('keydown', (event) => {
	keyupEditAttention(event);
});