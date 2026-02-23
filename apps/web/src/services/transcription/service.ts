import type {
	TranscriptionLanguage,
	TranscriptionResult,
	TranscriptionProgress,
	TranscriptionModelId,
	TranscriptionSegment,
} from "@/types/transcription";
import {
	DEFAULT_TRANSCRIPTION_MODEL,
	TRANSCRIPTION_MODELS,
	DEFAULT_CHUNK_LENGTH_SECONDS,
} from "@/constants/transcription-constants";
import type { WorkerMessage, WorkerResponse } from "./worker";

type ProgressCallback = (progress: TranscriptionProgress) => void;

class TranscriptionService {
	private worker: Worker | null = null;
	private currentModelId: TranscriptionModelId | null = null;
	private isInitialized = false;
	private isInitializing = false;
	private isCancelled = false;

	async transcribe({
		audioData,
		sampleRate = 16000,
		language = "auto",
		modelId = DEFAULT_TRANSCRIPTION_MODEL,
		onProgress,
	}: {
		audioData: Float32Array;
		sampleRate?: number;
		language?: TranscriptionLanguage;
		modelId?: TranscriptionModelId;
		onProgress?: ProgressCallback;
	}): Promise<TranscriptionResult> {
		this.isCancelled = false;
		await this.ensureWorker({ modelId, onProgress });

		onProgress?.({ status: "transcribing", progress: 0 });

		const chunkLengthSamples = Math.floor(
			DEFAULT_CHUNK_LENGTH_SECONDS * sampleRate,
		);
		const totalChunks = Math.ceil(audioData.length / chunkLengthSamples);

		const allSegments: TranscriptionSegment[] = [];
		let fullText = "";

		for (let i = 0; i < totalChunks; i++) {
			if (this.isCancelled) {
				throw new Error("Transcription cancelled");
			}

			const chunkStart = i * chunkLengthSamples;
			const chunkEnd = Math.min(
				chunkStart + chunkLengthSamples,
				audioData.length,
			);
			const audioChunk = audioData.slice(chunkStart, chunkEnd);
			const timeOffset = chunkStart / sampleRate;

			const chunkResult = await this.transcribeChunk({
				audioData: audioChunk,
				language,
			});

			for (const segment of chunkResult.segments) {
				allSegments.push({
					text: segment.text,
					start: segment.start + timeOffset,
					end: segment.end + timeOffset,
				});
			}
			fullText += chunkResult.text;

			onProgress?.({
				status: "transcribing",
				progress: Math.round(((i + 1) / totalChunks) * 100),
			});
		}

		return { text: fullText, segments: allSegments, language };
	}

	cancel() {
		this.isCancelled = true;
		this.worker?.postMessage({ type: "cancel" } satisfies WorkerMessage);
	}

	private transcribeChunk({
		audioData,
		language,
	}: {
		audioData: Float32Array;
		language: TranscriptionLanguage;
	}): Promise<{ text: string; segments: TranscriptionSegment[] }> {
		return new Promise((resolve, reject) => {
			if (!this.worker) {
				reject(new Error("Worker not initialized"));
				return;
			}

			const handleMessage = (event: MessageEvent<WorkerResponse>) => {
				const response = event.data;

				switch (response.type) {
					case "transcribe-complete":
						this.worker?.removeEventListener("message", handleMessage);
						resolve({
							text: response.text,
							segments: response.segments,
						});
						break;

					case "transcribe-error":
						this.worker?.removeEventListener("message", handleMessage);
						reject(new Error(response.error));
						break;

					case "cancelled":
						this.worker?.removeEventListener("message", handleMessage);
						reject(new Error("Transcription cancelled"));
						break;
				}
			};

			this.worker.addEventListener("message", handleMessage);

			this.worker.postMessage({
				type: "transcribe",
				audio: audioData,
				language,
			} satisfies WorkerMessage);
		});
	}

	private async ensureWorker({
		modelId,
		onProgress,
	}: {
		modelId: TranscriptionModelId;
		onProgress?: ProgressCallback;
	}): Promise<void> {
		const needsNewModel = this.currentModelId !== modelId;

		if (this.worker && this.isInitialized && !needsNewModel) {
			return;
		}

		if (this.isInitializing && !needsNewModel) {
			await this.waitForInit();
			return;
		}

		this.terminate();
		this.isInitializing = true;
		this.isInitialized = false;

		const model = TRANSCRIPTION_MODELS.find((m) => m.id === modelId);
		if (!model) {
			throw new Error(`Unknown model: ${modelId}`);
		}

		this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
			type: "module",
		});

		return new Promise((resolve, reject) => {
			if (!this.worker) {
				reject(new Error("Failed to create worker"));
				return;
			}

			const handleMessage = (event: MessageEvent<WorkerResponse>) => {
				const response = event.data;

				switch (response.type) {
					case "init-progress":
						onProgress?.({
							status: "loading-model",
							progress: response.progress,
							message: `Loading ${model.name} model...`,
						});
						break;

					case "init-complete":
						this.worker?.removeEventListener("message", handleMessage);
						this.isInitialized = true;
						this.isInitializing = false;
						this.currentModelId = modelId;
						resolve();
						break;

					case "init-error":
						this.worker?.removeEventListener("message", handleMessage);
						this.isInitializing = false;
						this.terminate();
						reject(new Error(response.error));
						break;
				}
			};

			this.worker.addEventListener("message", handleMessage);

			this.worker.postMessage({
				type: "init",
				modelId: model.huggingFaceId,
			} satisfies WorkerMessage);
		});
	}

	private waitForInit(): Promise<void> {
		return new Promise((resolve) => {
			const checkInit = () => {
				if (this.isInitialized) {
					resolve();
				} else if (!this.isInitializing) {
					resolve();
				} else {
					setTimeout(checkInit, 100);
				}
			};
			checkInit();
		});
	}

	terminate() {
		this.worker?.terminate();
		this.worker = null;
		this.isInitialized = false;
		this.isInitializing = false;
		this.currentModelId = null;
	}
}

export const transcriptionService = new TranscriptionService();
