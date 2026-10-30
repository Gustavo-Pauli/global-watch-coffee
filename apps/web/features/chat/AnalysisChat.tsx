"use client";
import type { Dispatch, SetStateAction, RefObject } from "react";
import * as Tabs from "radix-ui/tabs";
import { ArrowUp, FileImage, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { chatFallbackLabel, type ChatMessage } from "@/features/analyses/types";

export type AnalysisChatProps = {
 id: string; previewError: boolean; previewRevision: number; setPreviewError: Dispatch<SetStateAction<boolean>>; setPreviewRevision: Dispatch<SetStateAction<number>>; closeInspector: () => void; messages: ChatMessage[]; question: string; setQuestion: Dispatch<SetStateAction<string>>; chatLoading: boolean; questionInput: RefObject<HTMLTextAreaElement | null>; chatEnd: RefObject<HTMLDivElement | null>; sendQuestion: () => Promise<void>;
};

export default function AnalysisChat({ id, previewError, previewRevision, setPreviewError, setPreviewRevision, closeInspector, messages, question, setQuestion, chatLoading, questionInput, chatEnd, sendQuestion }: AnalysisChatProps) {
 return (
<Tabs.Content value="chat" className={"min-h-0 flex-1 flex flex-col"} aria-label="Assistente" data-testid="chat-panel">
                    <>
                      <div className={"min-h-0 flex-1 overflow-y-auto"} data-testid="chat-scroll">
                        <div className={"px-[17px] pt-[16px]"}>
                          {previewError ? (<Button  onClick={() => {
                        setPreviewError(false);
                        setPreviewRevision((value) => value + 1);
                    }} variant="native">
                              Recarregar imagem
                            </Button>) : (<Button className={"flex w-full items-center gap-[10px] rounded-[5px] border border-solid border-[#3a3a40] bg-[#27272a] p-[8px] text-left hover:border-[#6d6d76]"} onClick={closeInspector} aria-label="Ver classificação no mapa" data-testid="chat-image" variant="native">
                              <img key={previewRevision} src={`/api/analyses/${id}/files/classified`} alt="Imagem processada com os polígonos candidatos a café" onError={() => setPreviewError(true)} className={"h-[45px] w-[59px] rounded-[2px] bg-[#353539] object-cover"}/>
                              <span className={"flex items-center gap-[7px] text-[12px] text-[#c2c2ca]"}>
                                <FileImage size={14} aria-hidden="true"/>
                                Classificação da imagem
                              </span>
                            </Button>)}
                        </div>
                        {messages.length === 0 && (<div className={"px-[18px] py-[14px]"} data-testid="chat-empty">
                            <Button className={"mt-0 rounded-[5px] border border-solid border-border bg-transparent px-[10px] py-[9px] text-left text-[12px] text-[#c2c2ca] hover:bg-secondary"} onClick={() => {
                        setQuestion("Como interpretar as áreas candidatas?");
                        questionInput.current?.focus();
                    }} variant="native">
                              Como interpretar o resultado?
                            </Button>
                          </div>)}
                        <div className={"px-[17px] pb-[18px] pt-[6px]"} role="log" aria-label="Conversa sobre a análise" aria-live="polite" data-testid="chat-messages">
                          {messages.map((message, index) => (<div className={"mt-[21px] text-[13px] leading-[1.75]"} key={index} data-testid={`chat-message-${message.role}`}>
                              <span className={"mb-[6px] flex items-center justify-between gap-[8px] text-[12px] text-[var(--subtle)]"}>
                                {message.role === "user"
                        ? "Você"
                        : "Assistente"}
                                {message.mode === "rules_fallback_not_ai" && (<span className={"text-[12px] text-[#b5c4a9]"}>
                                    {chatFallbackLabel(message.reason)}
                                  </span>)}
                              </span>
                              <p className={cn(cn("whitespace-pre-wrap [overflow-wrap:anywhere]", message.role === "user" && "rounded-[6px] bg-[#2e2e33] px-[12px] py-[10px]"), cn("whitespace-pre-wrap [overflow-wrap:anywhere]", message.role === "user" && "rounded-[6px] bg-[#2e2e33] px-[12px] py-[10px]"))}>{message.text}</p>
                            </div>))}
                          {chatLoading && (<div className={"mt-[20px] flex items-center gap-[8px] text-[12px] text-muted-foreground"} role="status">
                              <LoaderCircle size={14} className={"animate-spin"}/>
                              Consultando análise…
                            </div>)}
                          <div ref={chatEnd}/>
                        </div>
                      </div>
                      <form className={"border-t border-solid border-border bg-[#1e1e21] p-[13px]"} onSubmit={(event) => {
                    event.preventDefault();
                    void sendQuestion();
                }} data-testid="chat-composer">
                        <div className={"relative rounded-[7px] border border-solid border-[#484851] bg-[#27272b] focus-within:border-[#9999a4]"}>
                          <textarea ref={questionInput} aria-label="Pergunta sobre a análise" value={question} placeholder="Pergunte sobre esta imagem…" rows={2} maxLength={1200} readOnly={chatLoading} aria-busy={chatLoading} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => {
                    if (event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void sendQuestion();
                    }
                }} className={"block min-h-[71px] w-full resize-none border-0 bg-transparent py-[11px] pl-[12px] pr-[43px] text-[13px] leading-[1.6] outline-none placeholder:text-[#8e8e98] pointer-coarse:text-[16px]"}/>
                          <Button className={"absolute bottom-[8px] right-[8px] flex size-[29px] items-center justify-center rounded-[5px] border-0 bg-[#dcdce0] p-0 text-[#252529] pointer-coarse:size-[36px]"} type="submit" aria-label="Enviar pergunta" disabled={chatLoading || question.trim().length < 2} variant="native">
                            {chatLoading ? (<LoaderCircle size={17} className={"animate-spin"}/>) : (<ArrowUp size={18}/>)}
                          </Button>
                        </div>
                      </form>
                    </>
                  </Tabs.Content>
);
}
