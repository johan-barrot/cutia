import { useTranslation } from "@i18next-toolkit/react";
import { Button } from "@/components/ui/button";
import { PanelBaseView as BaseView } from "@/components/editor/panels/panel-base-view";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useState, useRef } from "react";
import { extractTimelineAudio } from "@/lib/media/mediabunny";
import { useEditor } from "@/hooks/use-editor";
import { TRANSCRIPTION_LANGUAGES } from "@/constants/transcription-constants";
import {
	SUBTITLE_TEMPLATES,
	type SubtitleTemplate,
} from "@/constants/subtitle-constants";
import type {
	TranscriptionLanguage,
	TranscriptionProgress,
} from "@/types/transcription";
import { transcriptionService } from "@/services/transcription/service";
import { decodeAudioToFloat32 } from "@/lib/media/audio";
import { buildCaptionChunks } from "@/lib/transcription/caption";
import { Spinner } from "@/components/ui/spinner";
import { Label } from "@/components/ui/label";

export function Captions() {
	const { t } = useTranslation();
	const [selectedLanguage, setSelectedLanguage] =
		useState<TranscriptionLanguage>("auto");
	const [selectedTemplate, setSelectedTemplate] = useState<SubtitleTemplate>(
		SUBTITLE_TEMPLATES[0],
	);
	const [isProcessing, setIsProcessing] = useState(false);
	const [processingStep, setProcessingStep] = useState("");
	const [error, setError] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const editor = useEditor();

	const handleProgress = (progress: TranscriptionProgress) => {
		if (progress.status === "loading-model") {
			setProcessingStep(
				t("Loading model {{progress}}%", {
					progress: Math.round(progress.progress),
				}),
			);
		} else if (progress.status === "transcribing") {
			setProcessingStep(t("Transcribing..."));
		}
	};

	const handleGenerateTranscript = async () => {
		try {
			setIsProcessing(true);
			setError(null);
			setProcessingStep(t("Extracting audio..."));

			const audioBlob = await extractTimelineAudio({
				tracks: editor.timeline.getTracks(),
				mediaAssets: editor.media.getAssets(),
				totalDuration: editor.timeline.getTotalDuration(),
			});

			setProcessingStep(t("Preparing audio..."));
			const { samples } = await decodeAudioToFloat32({ audioBlob });

			const result = await transcriptionService.transcribe({
				audioData: samples,
				language: selectedLanguage === "auto" ? undefined : selectedLanguage,
				onProgress: handleProgress,
			});

			setProcessingStep(t("Generating captions..."));
			const captionChunks = buildCaptionChunks({ segments: result.segments });

			const captionTrackId = editor.timeline.addTrack({
				type: "text",
				index: 0,
			});

			const {
				templateId: _templateId,
				templateName: _templateName,
				...templateStyle
			} = selectedTemplate;

			for (let i = 0; i < captionChunks.length; i++) {
				const caption = captionChunks[i];
				editor.timeline.insertElement({
					placement: { mode: "explicit", trackId: captionTrackId },
					element: {
						...templateStyle,
						name: `Caption ${i + 1}`,
						content: caption.text,
						duration: caption.duration,
						startTime: caption.startTime,
						trimStart: 0,
						trimEnd: 0,
					},
				});
			}
		} catch (error) {
			console.error("Transcription failed:", error);
			setError(
				error instanceof Error
					? error.message
					: t("An unexpected error occurred"),
			);
		} finally {
			setIsProcessing(false);
			setProcessingStep("");
		}
	};

	const handleLanguageChange = ({ value }: { value: string }) => {
		if (value === "auto") {
			setSelectedLanguage("auto");
			return;
		}

		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(language) => language.code === value,
		);
		if (!matchedLanguage) return;
		setSelectedLanguage(matchedLanguage.code);
	};

	const handleTemplateChange = ({ value }: { value: string }) => {
		const template = SUBTITLE_TEMPLATES.find(
			(t) => t.templateId === value,
		);
		if (template) {
			setSelectedTemplate(template);
		}
	};

	return (
		<BaseView
			ref={containerRef}
			className="flex h-full flex-col justify-between"
		>
			<div className="flex flex-col gap-5">
				<div className="flex flex-col gap-3">
					<Label>{t("Language")}</Label>
					<Select
						value={selectedLanguage}
						onValueChange={(value) => handleLanguageChange({ value })}
					>
						<SelectTrigger>
							<SelectValue placeholder={t("Select a language")} />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="auto">{t("Auto detect")}</SelectItem>
							{TRANSCRIPTION_LANGUAGES.map((language) => (
								<SelectItem key={language.code} value={language.code}>
									{language.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="flex flex-col gap-3">
					<Label>{t("Subtitle Style")}</Label>
					<Select
						value={selectedTemplate.templateId}
						onValueChange={(value) => handleTemplateChange({ value })}
					>
						<SelectTrigger>
							<SelectValue placeholder={t("Select a style")} />
						</SelectTrigger>
						<SelectContent>
							{SUBTITLE_TEMPLATES.map((template) => (
								<SelectItem
									key={template.templateId}
									value={template.templateId}
								>
									{template.templateName}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<div
						className="flex items-center justify-center rounded-md border p-4"
						style={{ backgroundColor: "#1a1a2e", minHeight: 60 }}
					>
						<span
							style={{
								fontSize: 14,
								fontFamily: selectedTemplate.fontFamily,
								color: selectedTemplate.color,
								backgroundColor: selectedTemplate.backgroundColor,
								fontWeight: selectedTemplate.fontWeight,
								fontStyle: selectedTemplate.fontStyle,
								textDecoration: selectedTemplate.textDecoration,
								padding: "2px 6px",
								borderRadius: 2,
							}}
						>
							{t("{{name}} Preview", {
								name: selectedTemplate.templateName,
							})}
						</span>
					</div>
				</div>
			</div>

			<div className="flex flex-col gap-4">
				{error && (
					<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
						<p className="text-destructive text-sm">{error}</p>
					</div>
				)}

				<Button
					className="w-full"
					onClick={handleGenerateTranscript}
					disabled={isProcessing}
				>
					{isProcessing && <Spinner className="mr-1" />}
					{isProcessing ? processingStep : t("Generate transcript")}
				</Button>
			</div>
		</BaseView>
	);
}
