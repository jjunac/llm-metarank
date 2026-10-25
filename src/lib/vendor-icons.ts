const VENDOR_ICONS: Record<string, string> = {
  Anthropic: "/vendors/anthropic.svg",
  OpenAI: "/vendors/openai.svg",
  Google: "/vendors/gemini.svg",
  Meta: "/vendors/meta.svg",
  SpaceXAI: "/vendors/xai.svg",
  "Z.ai": "/vendors/zai.svg",
  Alibaba: "/vendors/qwen.svg",
  Moonshot: "/vendors/moonshot.svg",
  DeepSeek: "/vendors/deepseek.svg",
  Xiaomi: "/vendors/xiaomimimo.svg",
  MiniMax: "/vendors/minimax.svg",
  Mistral: "/vendors/mistral.svg",
  StepFun: "/vendors/stepfun.svg",
  NVIDIA: "/vendors/nvidia.svg",
  Tencent: "/vendors/tencent.svg",
};

export function vendorIcon(vendor: string): string | null {
  return VENDOR_ICONS[vendor] ?? null;
}
