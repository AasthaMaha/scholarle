# Proposal AI System — Architecture Overview

## Overview

This system is a **modular AI pipeline for generating government proposals** using:

* Retrieval-Augmented Generation (RAG)
* Structured prompt templates
* A node-based workflow (LangGraph)
* A shared state object for orchestration

The goal is to produce **grounded, structured, and reusable proposal outputs** while minimizing hallucinations.

---

## Core Concepts

### 1. Dual RAG System (Source of Truth)

The system separates information into two distinct sources:

```
documents/
├── rfp_docs/          # Requirements, instructions, source material
└── knowledge_base/    # Internal capabilities, past performance, etc.
```

Each is:

1. Ingested
2. Chunked
3. Embedded
4. Stored in a vector database (Chroma)

This enables:

* **RFP understanding** (what is required)
* **Knowledge grounding** (what we can say)

---

### 2. Vector Stores (Chroma)

Two independent vector databases are used:

* `rfp_store` → requirement documents
* `kb_store` → internal knowledge

Each query retrieves relevant chunks:

```
User Input / Requirements
        ↓
Vector Search (similarity)
        ↓
Relevant Context Chunks
```

These chunks are the **only authoritative content** used for generation.

---

### 3. Prompt Templates

Templates define how each section of the proposal is generated.

Each template includes:

* Purpose
* Required inputs
* Subsections
* Instructions
* Constraints (e.g., “do not hallucinate”)

Templates are used to construct structured prompts dynamically.

---

### 4. Nodes (AI Agents)

Each node represents a **single responsibility step** in the pipeline.

Examples:

* `analyze` → extract requirements from RFP
* `retrieve` → gather relevant context from RAG
* `generate` → create proposal sections
* `review` → critique output
* `score` → evaluate proposal quality
* `assemble` → combine into final output

Each node:

* receives the current state
* performs an LLM-driven task
* returns updates to the state

---

### 5. Shared State Object

The system uses a centralized state:

```python
ProposalState
```

This acts as the **data backbone** of the pipeline.

It stores:

* Inputs (RFP text, documents)
* Extracted requirements
* Retrieved context
* Generated sections
* Evaluation scores
* Final proposal output

Each node reads from and writes to this state.

---

### 6. Workflow Graph (LangGraph)

The pipeline is orchestrated as a directed graph:

```
analyze
   ↓
compliance
   ↓
retrieve
   ↓
generate
   ↓
review
   ↓
score
   ↓
assemble
   ↓
END
```

This provides:

* Deterministic execution
* Clear data flow
* Easy debugging and extension

---

### 7. Execution Flow

1. Load and ingest documents
2. Build vector stores
3. Initialize graph
4. Invoke graph with input state
5. Nodes execute sequentially
6. Final state contains:

   * Proposal text
   * Evaluation metrics

---

### 8. Output

The final output includes:

* Generated proposal sections
* Combined final proposal
* Structured evaluation scores (completeness, clarity, strength, hallucination penalty)

Optionally:

* Saved to file
* Exported to other formats (e.g., LaTeX)

---

## Key Design Principles

### Grounded Generation

All outputs should be based on retrieved context, not model memory.

### Separation of Concerns

Each node does one thing well.

### Deterministic Orchestration

No agent loops or randomness—clear execution path.

### Extensibility

New nodes (e.g., illustration, formatting) can be added without breaking the system.

---

## Mental Model

Think of the system as:

```
RFP → Understand → Retrieve Evidence → Generate → Critique → Score → Assemble
```

Where:

* RAG = memory
* Templates = instructions
* Nodes = workers
* State = shared workspace
* Graph = workflow

---

## Future Extensions

* Add a node that recommends graphics or illustrations
* Add an option to format proposal for LaTeX editors (e.g. escape special characters)
* Requirement-level traceability
* Automatically regenerate the proposal if the score is poor (<7)
* Add pdf, docx extraction

---

## Summary

This system is not just a prompt—it is a **structured AI application framework** that:

* Grounds outputs in real data
* Enforces consistency through templates
* Orchestrates logic through a graph
* Produces reusable, evaluatable proposal artifacts

---
