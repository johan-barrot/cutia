export interface TtsResult {
	duration: number;
	buffer: AudioBuffer;
	blob: Blob;
}

function base64ToArrayBuffer({ base64 }: { base64: string }): ArrayBuffer {
	const binaryString = atob(base64);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes.buffer;
}

export async function generateSpeechFromText({
	text,
}: {
	text: string;
}): Promise<TtsResult> {
	const response = await fetch("/api/tts/generate", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text }),
	});

	if (!response.ok) {
		const error = await response.json().catch(() => null);
		throw new Error(error?.error ?? `TTS request failed: ${response.status}`);
	}

	const { audio } = (await response.json()) as { audio: string };
	const arrayBuffer = base64ToArrayBuffer({ base64: audio });
	const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });

	const audioContext = new AudioContext();
	const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

	return {
		duration: buffer.duration,
		buffer,
		blob,
	};
}
