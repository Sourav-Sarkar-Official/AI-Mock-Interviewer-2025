/* eslint-disable @typescript-eslint/no-unused-vars */
import { useAuth } from "@clerk/clerk-react";
import {
  CircleStop,
  Loader,
  Mic,
  RefreshCw,
  Save,
  Edit,
  Video,
  VideoOff,
  WebcamIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import useSpeechToText, { ResultType } from "react-hook-speech-to-text";
import { useParams } from "react-router-dom";
import WebCam from "react-webcam";
import { TooltipButton } from "./tooltip-button";
import { toast } from "sonner";
import { chatSession } from "@/scripts";
import { SaveModal } from "./save-modal";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@/config/firebase.config";

interface RecordAnswerProps {
  question: { question: string; answer: string };
  isWebCam: boolean;
  setIsWebCam: (value: boolean) => void;
}

interface AIResponse {
  ratings: number;
  feedback: string;
}

export const RecordAnswer = ({
  question,
  isWebCam,
  setIsWebCam,
}: RecordAnswerProps) => {
  const {
    interimResult,
    isRecording,
    results,
    startSpeechToText,
    stopSpeechToText,
  } = useSpeechToText({
    continuous: true,
    useLegacyResults: false,
  });

  const [userAnswer, setUserAnswer] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<AIResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const { userId } = useAuth();
  const { interviewId } = useParams();

  const recordUserAnswer = async () => {
    if (isRecording) {
      stopSpeechToText();

      if (userAnswer?.length < 30) {
        toast.error("Error", {
          description: "Your answer should be more than 30 characters",
        });

        return;
      }

      //   ai result
      const aiResult = await generateResult(
        question.question,
        question.answer,
        userAnswer
      );

      setAiResult(aiResult);
    } else {
      startSpeechToText();
    }
  };

  const cleanJsonResponse = (responseText: string) => {
    // Step 1: Trim any surrounding whitespace
    let cleanText = responseText.trim();

    // Step 2: Remove any occurrences of "json" or code block symbols (``` or `)
    cleanText = cleanText.replace(/(json|```|`)/g, "");

    // Step 3: Parse the clean JSON text into an array of objects
    try {
      return JSON.parse(cleanText);
    } catch (error) {
      throw new Error("Invalid JSON format: " + (error as Error)?.message);
    }
  };

  const generateResult = async (
    qst: string,
    qstAns: string,
    userAns: string
  ): Promise<AIResponse> => {
    setIsAiGenerating(true);
    const prompt = `
      Question: "${qst}"
      User Answer: "${userAns}"
      Correct Answer: "${qstAns}"
      Please compare the user's answer to the correct answer, and provide a rating (from 1 to 10) based on answer quality, and offer feedback for improvement.
      Return the result in JSON format with the fields "ratings" (number) and "feedback" (string).
    `;

    try {
      const aiResult = await chatSession.sendMessage(prompt);

      const parsedResult: AIResponse = cleanJsonResponse(
        aiResult.response.text()
      );
      return parsedResult;
    } catch (error) {
      // Log, but provide a smooth fallback instead of an error toast
      console.warn("AI feedback generation failed, using fallback.", error);

      // Simple fallback: rate by answer length and give generic feedback
      const length = (userAns || "").trim().length;
      const ratings = Math.min(10, Math.max(1, Math.round(length / 50) || 1));
      const feedback = `Automatic feedback: Your answer is ${length} characters long. Try to structure answers with a short summary, key points, and a brief example or result.`;

      // Inform the user non-disruptively that fallback feedback was used
      toast("Note", {
        description: "AI service unavailable — providing automatic feedback.",
      });

      return { ratings, feedback };
    } finally {
      setIsAiGenerating(false);
    }
  };

  // Removed unused helpers: `recordNewAnswer` and `generateFromTypedAnswer`.

  const saveUserAnswer = async () => {
    setLoading(true);

    // If no aiResult exists yet, and user is typing, generate feedback first.
    if (!aiResult) {
      if (isTyping) {
        if ((userAnswer || "").trim().length < 30) {
          toast.error("Error", {
            description: "Your answer should be more than 30 characters",
          });
          setLoading(false);
          return;
        }

        try {
          const generated = await generateResult(
            question.question,
            question.answer,
            userAnswer
          );
          setAiResult(generated);
        } catch (err) {
          console.log(err);
          toast("Error", { description: "Failed to generate AI feedback." });
          setLoading(false);
          return;
        }
      } else {
        // not typing and no aiResult -> nothing to save
        toast.error("Error", {
          description: "No AI feedback available. Record your answer first or generate feedback.",
        });
        setLoading(false);
        return;
      }
    }

    const currentQuestion = question.question;
    try {
      // query the firbase to check if the user answer already exists for this question

      const userAnswerQuery = query(
        collection(db, "userAnswers"),
        where("userId", "==", userId),
        where("question", "==", currentQuestion)
      );

      const querySnap = await getDocs(userAnswerQuery);

      // if the user already answerd the question dont save it again
      if (!querySnap.empty) {
        console.log("Query Snap Size", querySnap.size);
        toast.info("Already Answered", {
          description: "You have already answered this question",
        });
        return;
      } else {
        // save the user answer
        const finalAi = aiResult!;
        await addDoc(collection(db, "userAnswers"), {
          mockIdRef: interviewId,
          question: question.question,
          correct_ans: question.answer,
          user_ans: userAnswer,
          feedback: finalAi.feedback,
          rating: finalAi.ratings,
          userId,
          createdAt: serverTimestamp(),
        });

        toast("Saved", { description: "Your answer has been saved.." });
      }

      setUserAnswer("");
      stopSpeechToText();
    } catch (error) {
      toast("Error", {
        description: "An error occurred while generating feedback.",
      });
      console.log(error);
    } finally {
      setLoading(false);
      setOpen(!open);
    }
  };

  useEffect(() => {
    const combineTranscripts = results
      .filter((result): result is ResultType => typeof result !== "string")
      .map((result) => result.transcript)
      .join(" ");

    setUserAnswer(combineTranscripts);
  }, [results]);

  return (
    <div className="w-full flex flex-col items-center gap-8 mt-4">
      {/* save modal */}
      <SaveModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfirm={saveUserAnswer}
        loading={loading}
      />

      <div className="w-full h-[400px] md:w-96 flex flex-col items-center justify-center border p-4 bg-gray-50 rounded-md">
        {isWebCam ? (
          <WebCam
            onUserMedia={() => setIsWebCam(true)}
            onUserMediaError={() => setIsWebCam(false)}
            className="w-full h-full object-cover rounded-md"
          />
        ) : (
          <WebcamIcon className="min-w-24 min-h-24 text-muted-foreground" />
        )}
      </div>

      <div className="flex itece justify-center gap-3">
        {/* 1) Camera toggle */}
        <TooltipButton
          content={isWebCam ? "Turn Off" : "Turn On"}
          icon={isWebCam ? <VideoOff className="min-w-5 min-h-5" /> : <Video className="min-w-5 min-h-5" />}
          onClick={() => setIsWebCam(!isWebCam)}
        />

        {/* 2) Voice recording (start/stop) - disabled while typing is active */}
        <TooltipButton
          content={isRecording ? "Stop Recording" : "Start Recording"}
          icon={isRecording ? <CircleStop className="min-w-5 min-h-5" /> : <Mic className="min-w-5 min-h-5" />}
          onClick={async () => {
            // when user initiates voice recording, ensure typing mode is off
            if (!isRecording) {
              setIsTyping(false);
            }
            await recordUserAnswer();
          }}
          disabled={isTyping}
        />

        {/* 3) Typing mode toggle - disabled while recording is active */}
        <TooltipButton
          content={isTyping ? "Typing: ON" : "Type Answer"}
          icon={<Edit className="min-w-5 min-h-5" />}
          onClick={() => {
            const next = !isTyping;
            setIsTyping(next);
            if (next) {
              // entering typing mode: stop any speech recognition
              stopSpeechToText();
            } else {
              // leaving typing mode: clear typed text to avoid accidental reuse
              setUserAnswer("");
            }
          }}
          disabled={isRecording}
        />

        {/* Retake / clear answer */}
        <TooltipButton
          content="Record Again"
          icon={<RefreshCw className="min-w-5 min-h-5" />}
          onClick={() => {
            setUserAnswer("");
            setAiResult(null);
            if (!isTyping) {
              stopSpeechToText();
              startSpeechToText();
            }
          }}
        />

        {/* Save button: enabled only after aiResult is available */}
        <TooltipButton
          content="Save Result"
          icon={isAiGenerating ? <Loader className="min-w-5 min-h-5 animate-spin" /> : <Save className="min-w-5 min-h-5" />}
          onClick={() => setOpen(!open)}
          disabled={!(aiResult || (isTyping && (userAnswer || "").trim().length >= 30))}
        />
      </div>
      <div className="w-full mt-4 p-4 border rounded-md bg-gray-50">
        <h2 className="text-lg font-semibold">Your Answer:</h2>

        {isTyping ? (
          <>
            <textarea
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              rows={6}
              className="w-full mt-2 p-3 border rounded-md text-sm"
              placeholder="Type your answer here..."
            />

            {/* Word / character counter */}
            <div className="w-full flex justify-end mt-2">
              <div className="text-sm text-gray-500">
                {(() => {
                  const trimmed = (userAnswer || "").trim();
                  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
                  const chars = (userAnswer || "").length;
                  const charClass = chars < 30 ? "text-rose-500" : "text-emerald-600";
                  return (
                    <span className={`${charClass}`}>
                      Words: {words} • Chars: {chars}
                    </span>
                  );
                })()}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm mt-2 text-gray-700 whitespace-normal">
            {userAnswer || "Start recording to see your ansewer here"}
          </p>
        )}

        {interimResult && !isTyping && (
          <p className="text-sm text-gray-500 mt-2">
            <strong>Current Speech:</strong>
            {interimResult}
          </p>
        )}
      </div>
    </div>
  );
};
