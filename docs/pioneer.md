# Pioneer AI

Platform for fine-tuning, evaluating, and deploying small language models (SLMs) and LLMs. OpenAI and Anthropic compatible.

- Base URL: `https://api.pioneer.ai`
- Platform: `https://agent.pioneer.ai`
- Auth: `X-API-Key` header (keys start with `pio_sk_`). Bearer auth also supported.

## Quick Start

```bash
curl -X POST https://api.pioneer.ai/inference \
  -H "X-API-Key: $PIONEER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model_id":"YOUR_MODEL_ID","task":"extract_entities","text":"Apple launched iPhone in SF.","schema":["organization","product","location"]}'
```

Recommended order: create/upload dataset, train, poll status, evaluate, run inference.

## Inference (Pioneer format)

- `POST /inference` run inference
- `GET /base-models` list catalog (filter by training/inference/task_type)

Task types: `extract_entities`, `classify_text`, `extract_json`, `generate`. For `classify_text`, schema is `{"categories":["a","b"]}`.

Response includes `inference_id`, `result`, `model_id`, `latency_ms`, `token_usage`.

## Inference (OpenAI compatible)

- `POST /v1/chat/completions`, `/v1/completions`, `/v1/responses`
- `GET /v1/models`

```python
from openai import OpenAI
client = OpenAI(base_url="https://api.pioneer.ai/v1", api_key="YOUR_API_KEY")
r = client.chat.completions.create(
    model="YOUR_MODEL_ID",
    messages=[{"role":"user","content":"Extract entities from..."}],
    extra_body={"schema":["organization","product","location"]},
)
```

## Inference (Anthropic compatible)

- `POST /v1/messages`

```python
import anthropic
client = anthropic.Anthropic(base_url="https://api.pioneer.ai", api_key="YOUR_API_KEY")
```

## Datasets

- `GET /felix/datasets`, `GET /felix/datasets/:name`, `DELETE /felix/datasets/:name`

Upload flow (presigned S3):
1. `POST /felix/datasets/upload/url` body `{dataset_name, dataset_type, format}`
2. `PUT $PRESIGNED_URL` with file body
3. `POST /felix/datasets/upload/process` body `{dataset_id}`

Valid `dataset_type`: `ner`, `classification`, `custom`, `decoder`. Files: JSON, JSONL, CSV up to 50 MB.

## Synthetic Data

- `POST /generate` (body: `task_type` ner/classification/decoder, `dataset_name`, `num_examples`, optional `labels`, `domain_description`, `prompt`)
- `GET /generate/jobs/:job_id` poll status
- `POST /generate/ner/label-existing` and `/generate/classification/label-existing` to auto-label up to 1000 inputs.

## Training

- `POST /felix/training-jobs` (body requires `base_model`)
- `GET /felix/training-jobs` (filter status, project_id)
- `GET /felix/training-jobs/:id`, `/logs`, `/checkpoints`, `/download`
- `POST /felix/training-jobs/:id/stop`, `DELETE /felix/training-jobs/:id`
- `GET /felix/trained-models`

```bash
curl -X POST https://api.pioneer.ai/felix/training-jobs \
  -H "X-API-Key: $PIONEER_API_KEY" -H "Content-Type: application/json" \
  -d '{"model_name":"my-model","base_model":"fastino/gliner2-base-v1",
       "datasets":[{"name":"YOUR_DATASET"}],
       "training_type":"lora","nr_epochs":10,"learning_rate":5e-5,"batch_size":8}'
```

Hyperparameters: `learning_rate`, `nr_epochs`, `batch_size`, `training_type` (lora/full), train/test split. Metrics tracked live: F1, precision, recall, loss.

## Evaluations

- `POST /felix/evaluations` body `{base_model, dataset_name}` (base_model accepts a training job ID)
- `GET /felix/evaluations` (filter project_id), `GET /:id`, `DELETE /:id`
- `GET /felix/baseline-models`

Metrics: F1 (primary), precision, recall, per-entity/class breakdown. Compare fine-tuned vs base/LLMs/other SLMs.

## Projects & Deployments

- `GET/POST /projects`, `DELETE /projects/:id`
- `POST /projects/:id/deployments` (requires `training_job_id`)
- `GET /projects/:id/deployments`
- `POST /projects/:id/inference`

## API Keys

- `POST /create-api-key`, `GET /list-api-keys`, `DELETE /delete-api-key`

## Inference History

- `GET /inferences` (filters: limit, offset, model_id, task, project_id, training_job_id)
- `GET /inferences/:id`
- `POST /inferences/:id/feedback` submit corrections

## Available Models

Encoder (NER/GLiNER): `fastino/gliner2-base-v1`, `gliner2-large-v1`, `gliner2-multi-v1`, `gliner2-multi-large-v1`. LoRA + full training, on-demand inference.

Decoder training (LoRA): Qwen3 (4B/8B/30B/32B variants), Qwen2.5 (Coder 0.5B, 7B, 14B), Gemma 4 31B, Llama 3.1/3.2/3.3 (1B-70B), Nemotron 3 Nano 30B, GPT-OSS 20B/120B, DeepSeek V3.1. Context: 32K-262K.

Decoder serverless (no startup latency, pay-per-token): Qwen3-235B-A22B-Instruct, Qwen3-8B, DeepSeek V3.1, GPT-OSS 20B/120B, Llama 3.3 70B, Kimi K2 Thinking.

## Dataset Formats

NER: `{"text":"...", "entities":[["Apple","ORG"],["iPhone","PRODUCT"]]}`

Classification: single `{"text":"...","label":"positive"}` or multi `{"text":"...","labels":["tech","business"]}`

JSON extraction: same as NER.

Decoder/chat SFT:
```json
{"messages":[
  {"role":"system","content":"..."},
  {"role":"user","content":"..."},
  {"role":"assistant","content":"..."}
]}
```

Auto-detects OpenAI/ChatML, Alpaca, ShareGPT, Prompt/Output, Instruction/Response. JSONL recommended for big sets.

## Terminology

- **SLM**: small task-specific model. A 205M model trained on your data can beat LLMs on that task.
- **Training**: LoRA or full fine-tune on a base model.
- **Evaluation**: held-out test set scored vs expected.
- **Inference**: structured predictions in milliseconds.
- **Continuous Adaptation**: prod logs feed agent-curated data, retrain, eval, promote best checkpoint.

## Notes

- Free plan to experiment, Pro for uncapped inference, Custom for HIPAA/VPC.
- No storage charges for datasets.
- Opt-out of training on your data on Pro and Custom.
- Teams = shared billing only, workspaces stay separate.

Refs: `https://agent.pioneer.ai/llms-full.txt`, `https://agent.pioneer.ai/openapi.json`, `https://api.pioneer.ai/docs`.
