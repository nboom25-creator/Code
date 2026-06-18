"""Autonomous LLM agent layer (Research-then-Decide cognitive loop).

This package sits on top of the rule-based bot's broker/data layer and adds a
multi-step cognitive architecture driven by Claude:

    Perception -> Cognitive Planning -> Reflection -> Action -> Memory/Audit

The design principle is **the LLM proposes, deterministic code disposes**: the
model is given read-only tools and emits structured decisions, but the hard risk
guardrails and order execution live in plain Python the model cannot reach.
"""
