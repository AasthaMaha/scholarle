def assemble(state):
    final = f"""
# Executive Summary
{state.get('exec_summary')}

# Technical Approach
{state.get('technical_volume')}

# Past Performance
{state.get('past_performance')}

# Review Notes
{state.get('review_notes')}

# Score
{state.get('score')}
"""

    return {"final_proposal": final}