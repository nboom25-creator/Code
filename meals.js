// Meal dataset — all recipes are FISH/SEAFOOD-FREE and free of the onion family
// (no onion, scallion, shallot, leek, or chive). GARLIC IS ALLOWED.
// No fish sauce / shrimp paste — Thai dishes use soy sauce / coconut aminos.
// Quantities are the BASELINE for 2 servings. Scale with: qty * (servings / 2).
// `discrete: true` => round to whole units when scaling (eggs, cans, tortillas...).
// category: Produce | Proteins | Pantry

const MEALS = [
  // ---------------------------------------------------------------- Italian-American
  {
    id: "rigatoni-herb-chicken", name: "Tuscan Tomato-Basil Rigatoni with Herb Chicken",
    cuisine: "Italian-American", minutes: 35,
    ingredients: [
      { name: "fresh basil leaves", qty: 2, unit: "cup", category: "Produce", discrete: false },
      { name: "carrot, finely grated", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "chicken breast", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "rigatoni", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "crushed tomatoes", qty: 14.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "heavy cream", qty: 0.333, unit: "cup", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.25, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "fennel seed", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook rigatoni to al dente (~11 min); reserve ½ cup water, drain.",
      "Sear seasoned chicken in 1 tbsp oil 5–6 min to 165°F; remove.",
      "Cook carrot, garlic, fennel, oregano in remaining oil 2–3 min.",
      "Add tomato paste 1 min, crushed tomatoes + salt; simmer 8 min.",
      "Stir in cream and Parmesan; return chicken, add pasta and basil, loosen with pasta water."
    ]
  },
  {
    id: "eggplant-parm", name: "Eggplant Parmesan with Spaghetti",
    cuisine: "Italian-American", minutes: 50,
    ingredients: [
      { name: "eggplant", qty: 1, unit: "lb", category: "Produce", discrete: false },
      { name: "fresh basil leaves", qty: 1, unit: "cup", category: "Produce", discrete: false },
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "eggs", qty: 2, unit: "whole", category: "Proteins", discrete: true },
      { name: "spaghetti", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "Italian breadcrumbs", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "shredded mozzarella", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "crushed tomatoes", qty: 14.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Salt eggplant rounds, rest 15 min, pat dry. Heat oven to 400°F.",
      "Bread slices (egg, then crumbs + ¼ cup Parmesan); bake on oiled pan 20 min, flipping once.",
      "Sauce: cook garlic + oregano in oil 1 min, add paste 1 min, tomatoes + salt; simmer 10 min with half the basil.",
      "Layer sauce, eggplant, mozzarella; bake 12–15 min.",
      "Serve over spaghetti with remaining Parmesan and basil."
    ]
  },
  {
    id: "chicken-parm", name: "Chicken Parmesan with Spaghetti",
    cuisine: "Italian-American", minutes: 45,
    ingredients: [
      { name: "fresh basil leaves", qty: 0.5, unit: "cup", category: "Produce", discrete: false },
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "chicken breast, pounded thin", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "eggs", qty: 2, unit: "whole", category: "Proteins", discrete: true },
      { name: "spaghetti", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "Italian breadcrumbs", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "shredded mozzarella", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "crushed tomatoes", qty: 14.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 400°F. Bread chicken (egg, then crumbs + ¼ cup Parmesan).",
      "Pan-fry in oil 3 min per side until golden; move to a baking dish.",
      "Sauce: cook garlic + oregano in oil 1 min, add paste 1 min, tomatoes + salt; simmer 10 min.",
      "Top chicken with sauce and mozzarella; bake 12–15 min to 165°F.",
      "Serve over spaghetti with basil and remaining Parmesan."
    ]
  },
  {
    id: "baked-ziti", name: "Baked Ziti with Herbed Ricotta",
    cuisine: "Italian-American", minutes: 50,
    ingredients: [
      { name: "fresh basil leaves", qty: 0.5, unit: "cup", category: "Produce", discrete: false },
      { name: "garlic, minced", qty: 4, unit: "clove", category: "Produce", discrete: true },
      { name: "ground beef or Italian-seasoned pork", qty: 10, unit: "oz", category: "Proteins", discrete: false },
      { name: "ricotta cheese", qty: 1, unit: "cup", category: "Proteins", discrete: false },
      { name: "ziti", qty: 10, unit: "oz", category: "Pantry", discrete: false },
      { name: "crushed tomatoes", qty: 14.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "shredded mozzarella", qty: 1.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.25, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "fennel seed", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 375°F. Cook ziti 2 min shy of al dente; drain.",
      "Brown meat in oil with garlic, fennel, oregano, salt 6 min; add paste 1 min, tomatoes; simmer 10 min.",
      "Mix ricotta with Parmesan and chopped basil.",
      "Layer pasta, sauce, ricotta, mozzarella; bake 25 min until golden."
    ]
  },
  {
    id: "spaghetti-meatballs", name: "Spaghetti & Garlic-Herb Meatballs",
    cuisine: "Italian-American", minutes: 45,
    ingredients: [
      { name: "garlic, minced", qty: 4, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh parsley, chopped", qty: 3, unit: "tbsp", category: "Produce", discrete: false },
      { name: "ground beef", qty: 10, unit: "oz", category: "Proteins", discrete: false },
      { name: "egg", qty: 1, unit: "whole", category: "Proteins", discrete: true },
      { name: "spaghetti", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "breadcrumbs", qty: 0.333, unit: "cup", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.333, unit: "cup", category: "Pantry", discrete: false },
      { name: "crushed tomatoes", qty: 14.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Mix beef, egg, breadcrumbs, half the garlic, parsley, Parmesan, ½ tsp salt; roll into 1-inch balls.",
      "Brown meatballs in oil 6 min; remove.",
      "Cook remaining garlic + oregano in pan 1 min; add paste, tomatoes, salt; simmer with meatballs 15 min.",
      "Cook spaghetti; toss with sauce, top with meatballs and Parmesan."
    ]
  },
  {
    id: "fettuccine-alfredo", name: "Fettuccine Alfredo with Grilled Chicken",
    cuisine: "Italian-American", minutes: 30,
    ingredients: [
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh parsley, chopped", qty: 2, unit: "tbsp", category: "Produce", discrete: false },
      { name: "chicken breast", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "fettuccine", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "heavy cream", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "butter", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false },
      { name: "black pepper", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Season and grill/sear chicken in oil 5–6 min to 165°F; rest and slice.",
      "Cook fettuccine to al dente; reserve ½ cup water.",
      "Melt butter, soften garlic 1 min, add cream; simmer 3 min, whisk in Parmesan.",
      "Toss pasta in sauce with pasta water; top with chicken, parsley, pepper."
    ]
  },
  {
    id: "tuscan-chicken", name: "Creamy Tuscan Garlic Chicken",
    cuisine: "Italian-American", minutes: 35,
    ingredients: [
      { name: "garlic, minced", qty: 4, unit: "clove", category: "Produce", discrete: true },
      { name: "baby spinach", qty: 3, unit: "cup", category: "Produce", discrete: false },
      { name: "chicken thighs", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "sun-dried tomatoes", qty: 0.333, unit: "cup", category: "Pantry", discrete: false },
      { name: "heavy cream", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.333, unit: "cup", category: "Pantry", discrete: false },
      { name: "chicken broth", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "Italian seasoning", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Sear seasoned chicken in oil 5–6 min per side to 165°F; remove.",
      "Soften garlic and sun-dried tomatoes 1 min; add broth, cream, Italian seasoning.",
      "Simmer 3 min, whisk in Parmesan, wilt spinach.",
      "Return chicken; spoon sauce over. Serve with pasta or bread."
    ]
  },
  {
    id: "sausage-pepper-penne", name: "Italian Sausage & Pepper Penne",
    cuisine: "Italian-American", minutes: 35,
    ingredients: [
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "red bell pepper, sliced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh basil leaves", qty: 0.5, unit: "cup", category: "Produce", discrete: false },
      { name: "garlic-fennel Italian sausage (onion-free)", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "penne", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "crushed tomatoes", qty: 14.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.25, unit: "cup", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook penne to al dente.",
      "Brown crumbled sausage in oil 6 min; add bell pepper and garlic 3 min.",
      "Stir in paste 1 min, tomatoes, oregano, salt; simmer 10 min.",
      "Toss with pasta and basil; finish with Parmesan."
    ]
  },
  {
    id: "margherita-flatbread", name: "Garlic-Oil Margherita Flatbread",
    cuisine: "Italian-American", minutes: 25,
    ingredients: [
      { name: "garlic, minced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh basil leaves", qty: 0.5, unit: "cup", category: "Produce", discrete: false },
      { name: "Roma tomatoes, sliced", qty: 2, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh mozzarella", qty: 6, unit: "oz", category: "Proteins", discrete: false },
      { name: "flatbreads or naan", qty: 2, unit: "whole", category: "Pantry", discrete: true },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.25, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 450°F. Stir garlic into olive oil; brush over flatbreads.",
      "Spread thin tomato paste, layer mozzarella and tomato slices, sprinkle oregano + salt.",
      "Bake 10–12 min until cheese bubbles and edges crisp.",
      "Top with fresh basil; slice."
    ]
  },
  {
    id: "lasagna", name: "Classic Beef Lasagna",
    cuisine: "Italian-American", minutes: 75,
    ingredients: [
      { name: "garlic, minced", qty: 4, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh basil leaves", qty: 0.5, unit: "cup", category: "Produce", discrete: false },
      { name: "ground beef", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "ricotta cheese", qty: 1.5, unit: "cup", category: "Proteins", discrete: false },
      { name: "egg", qty: 1, unit: "whole", category: "Proteins", discrete: true },
      { name: "lasagna noodles", qty: 9, unit: "sheet", category: "Pantry", discrete: true },
      { name: "crushed tomatoes", qty: 28, unit: "oz can", category: "Pantry", discrete: true },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "shredded mozzarella", qty: 2, unit: "cup", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 1, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 375°F. Brown beef in oil with garlic, oregano, salt; add paste, tomatoes; simmer 15 min.",
      "Mix ricotta with egg, Parmesan, chopped basil.",
      "Layer sauce, noodles, ricotta, mozzarella; repeat, ending with sauce and mozzarella.",
      "Cover, bake 30 min; uncover, bake 15 min. Rest 10 min."
    ]
  },
  {
    id: "pesto-penne", name: "Basil Pesto Penne with Cherry Tomatoes",
    cuisine: "Italian-American", minutes: 25,
    ingredients: [
      { name: "fresh basil leaves", qty: 2, unit: "cup", category: "Produce", discrete: false },
      { name: "garlic", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "cherry tomatoes, halved", qty: 1.5, unit: "cup", category: "Produce", discrete: false },
      { name: "chicken breast, diced (optional)", qty: 8, unit: "oz", category: "Proteins", discrete: false },
      { name: "penne", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "pine nuts", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 0.333, unit: "cup", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Blend basil, garlic, pine nuts, Parmesan, olive oil, salt into pesto.",
      "Cook penne to al dente; reserve ¼ cup water.",
      "Sear chicken if using; toss pasta with pesto, loosening with pasta water.",
      "Fold in cherry tomatoes; top with extra Parmesan."
    ]
  },
  {
    id: "chicken-piccata", name: "Chicken Piccata with Angel Hair",
    cuisine: "Italian-American", minutes: 30,
    ingredients: [
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "lemon", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh parsley, chopped", qty: 3, unit: "tbsp", category: "Produce", discrete: false },
      { name: "chicken breast, pounded thin", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "angel hair pasta", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "capers, drained", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "chicken broth", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "butter", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "all-purpose flour", qty: 0.25, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Dredge salted chicken in flour; sear in oil 3 min per side; remove.",
      "Soften garlic in butter 30 sec; add broth, lemon juice, capers; simmer 3 min.",
      "Return chicken to glaze 2 min.",
      "Serve over angel hair with parsley."
    ]
  },
  {
    id: "cacio-e-pepe", name: "Cacio e Pepe with Roasted Broccoli",
    cuisine: "Italian-American", minutes: 25,
    ingredients: [
      { name: "broccoli florets", qty: 3, unit: "cup", category: "Produce", discrete: false },
      { name: "garlic, sliced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "spaghetti", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "Pecorino Romano, grated", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "black pepper, coarse", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Roast broccoli with garlic, oil, salt at 425°F for 18 min.",
      "Cook spaghetti to al dente; reserve 1 cup starchy water.",
      "Toast pepper in a pan; add ¾ cup pasta water, then pasta.",
      "Off heat, toss vigorously with Pecorino and more water to a creamy sauce. Serve with broccoli."
    ]
  },
  // ---------------------------------------------------------------- American
  {
    id: "meatloaf", name: "Classic Glazed Meatloaf with Mashed Potatoes & Green Beans",
    cuisine: "American", minutes: 60,
    ingredients: [
      { name: "carrot, finely grated", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "garlic, minced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "Yukon Gold potatoes", qty: 1, unit: "lb", category: "Produce", discrete: false },
      { name: "green beans, trimmed", qty: 8, unit: "oz", category: "Produce", discrete: false },
      { name: "ground beef (80/20)", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "egg", qty: 1, unit: "whole", category: "Proteins", discrete: true },
      { name: "breadcrumbs", qty: 0.333, unit: "cup", category: "Pantry", discrete: false },
      { name: "ketchup", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "Worcestershire (anchovy-free)", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "butter", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "milk", qty: 0.333, unit: "cup", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 375°F. Mix beef, egg, carrot, garlic, breadcrumbs, 2 tbsp milk, paprika, Worcestershire, salt; shape into a loaf.",
      "Brush with ketchup + brown sugar; bake 40–45 min to 160°F; rest 5 min.",
      "Boil potatoes 15 min; mash with butter, remaining milk, salt.",
      "Steam green beans 4–5 min; toss with butter."
    ]
  },
  {
    id: "bbq-pulled-chicken", name: "BBQ Pulled Chicken Sliders with Slaw",
    cuisine: "American", minutes: 40,
    ingredients: [
      { name: "green cabbage, shredded", qty: 2, unit: "cup", category: "Produce", discrete: false },
      { name: "carrot, shredded", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "garlic, minced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "chicken thighs", qty: 14, unit: "oz", category: "Proteins", discrete: false },
      { name: "slider buns", qty: 6, unit: "whole", category: "Pantry", discrete: true },
      { name: "ketchup", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "apple cider vinegar", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "mayonnaise", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Simmer chicken in water with ½ tsp salt 18–20 min to 165°F; shred.",
      "Make sauce: ketchup, vinegar, brown sugar, paprika, garlic; simmer 5 min, toss with chicken.",
      "Slaw: cabbage, carrot, mayo, pinch salt and splash vinegar.",
      "Pile chicken on buns, top with slaw."
    ]
  },
  {
    id: "stuffed-peppers", name: "Cheesy Beef & Rice Stuffed Bell Peppers",
    cuisine: "American", minutes: 55,
    ingredients: [
      { name: "bell peppers, halved", qty: 3, unit: "whole", category: "Produce", discrete: true },
      { name: "carrot, finely grated", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "ground beef", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "cooked rice", qty: 1.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "crushed tomatoes", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "tomato paste", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "shredded cheese", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 375°F. Brown beef in oil with carrot, garlic, paprika, oregano, salt 6 min.",
      "Stir in rice, tomatoes, paste; simmer 3 min.",
      "Fill pepper halves, top with cheese; bake 30–35 min until tender."
    ]
  },
  {
    id: "pork-chops-apples", name: "Pan-Seared Pork Chops with Skillet Apples & Mash",
    cuisine: "American", minutes: 40,
    ingredients: [
      { name: "apples, sliced", qty: 2, unit: "whole", category: "Produce", discrete: true },
      { name: "garlic, minced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "Yukon Gold potatoes", qty: 1, unit: "lb", category: "Produce", discrete: false },
      { name: "fresh thyme", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "bone-in pork chops", qty: 2, unit: "whole", category: "Proteins", discrete: true },
      { name: "butter", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "milk", qty: 0.25, unit: "cup", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "apple cider vinegar", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Boil potatoes 15 min; mash with butter, milk, salt.",
      "Sear seasoned chops in oil 4 min per side to 145°F; rest.",
      "Melt 1 tbsp butter, soften garlic and thyme; cook apples with brown sugar, vinegar 5 min.",
      "Serve chops over mash, spooned with apples."
    ]
  },
  {
    id: "smash-burgers", name: "Smash Burgers with Oven Fries",
    cuisine: "American", minutes: 35,
    ingredients: [
      { name: "russet potatoes", qty: 2, unit: "whole", category: "Produce", discrete: true },
      { name: "garlic powder", qty: 1, unit: "tsp", category: "Produce", discrete: false },
      { name: "tomato, sliced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "lettuce leaves", qty: 4, unit: "leaf", category: "Produce", discrete: true },
      { name: "ground beef (80/20)", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "American cheese", qty: 4, unit: "slice", category: "Proteins", discrete: true },
      { name: "burger buns", qty: 2, unit: "whole", category: "Pantry", discrete: true },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "mayonnaise", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 425°F. Cut potatoes into fries; toss with oil, garlic powder, salt; bake 28–30 min, flipping.",
      "Form 4 loose beef balls; smash hard on a screaming-hot skillet, salt, 2 min.",
      "Flip, add cheese, 1 min. Toast buns.",
      "Build with mayo, lettuce, tomato."
    ]
  },
  {
    id: "roast-chicken", name: "Garlic-Butter Roast Chicken with Potatoes",
    cuisine: "American", minutes: 75,
    ingredients: [
      { name: "garlic", qty: 6, unit: "clove", category: "Produce", discrete: true },
      { name: "baby potatoes, halved", qty: 1, unit: "lb", category: "Produce", discrete: false },
      { name: "lemon", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh rosemary", qty: 2, unit: "sprig", category: "Produce", discrete: true },
      { name: "bone-in chicken thighs", qty: 4, unit: "whole", category: "Proteins", discrete: true },
      { name: "butter, softened", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "black pepper", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 425°F. Mash butter with half the minced garlic; rub under and over chicken skin; season.",
      "Toss potatoes with oil, remaining garlic, salt; spread in a pan with rosemary and lemon halves.",
      "Nestle chicken on top; roast 40–45 min to 175°F and crisp skin.",
      "Squeeze roasted lemon over before serving."
    ]
  },
  {
    id: "honey-garlic-chicken", name: "Honey-Garlic Chicken Thighs over Rice",
    cuisine: "American", minutes: 30,
    ingredients: [
      { name: "garlic, minced", qty: 4, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh ginger, minced", qty: 1, unit: "tsp", category: "Produce", discrete: false },
      { name: "broccoli florets", qty: 2, unit: "cup", category: "Produce", discrete: false },
      { name: "boneless chicken thighs", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "white rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "honey", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "rice vinegar", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "cornstarch", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook rice; steam broccoli.",
      "Sear chicken in oil 5–6 min to 165°F; remove and slice.",
      "Soften garlic + ginger; add honey, soy, vinegar, and cornstarch slurry; simmer to glossy.",
      "Toss chicken in glaze; serve over rice with broccoli."
    ]
  },
  {
    id: "maple-pork-tenderloin", name: "Maple-Mustard Pork Tenderloin with Roasted Carrots",
    cuisine: "American", minutes: 45,
    ingredients: [
      { name: "carrots, cut into sticks", qty: 1, unit: "lb", category: "Produce", discrete: false },
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh thyme", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "pork tenderloin", qty: 1, unit: "lb", category: "Proteins", discrete: false },
      { name: "maple syrup", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "Dijon mustard", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false },
      { name: "black pepper", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 425°F. Whisk maple, Dijon, garlic, 1 tbsp oil.",
      "Sear salted tenderloin in 1 tbsp oil on all sides; brush with glaze.",
      "Toss carrots with oil, thyme, salt; roast with pork 18–22 min to 145°F.",
      "Rest pork 5 min; slice and drizzle remaining glaze."
    ]
  },
  {
    id: "turkey-chili", name: "Smoky Turkey & Bean Chili",
    cuisine: "American", minutes: 45,
    ingredients: [
      { name: "garlic, minced", qty: 4, unit: "clove", category: "Produce", discrete: true },
      { name: "red bell pepper, diced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "ground turkey", qty: 14, unit: "oz", category: "Proteins", discrete: false },
      { name: "kidney beans", qty: 15, unit: "oz can", category: "Proteins", discrete: true },
      { name: "crushed tomatoes", qty: 14.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "chili powder", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "vegetable broth", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 1, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Brown turkey in oil 6 min; add garlic, bell pepper 2 min.",
      "Stir in chili powder, cumin, paprika, paste 1 min.",
      "Add tomatoes, beans, broth, salt; simmer 25 min, stirring.",
      "Serve with cheese or cornbread."
    ]
  },
  {
    id: "mac-and-cheese", name: "Baked Mac & Cheese with Garlic Breadcrumbs",
    cuisine: "American", minutes: 40,
    ingredients: [
      { name: "garlic, minced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "elbow macaroni", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "sharp cheddar, shredded", qty: 2, unit: "cup", category: "Pantry", discrete: false },
      { name: "milk", qty: 2, unit: "cup", category: "Pantry", discrete: false },
      { name: "butter", qty: 4, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "all-purpose flour", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "panko breadcrumbs", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "ground mustard", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 375°F. Cook macaroni 1 min shy of al dente.",
      "Melt 3 tbsp butter, whisk in flour 1 min, then milk; simmer to thicken. Off heat add cheddar, mustard, salt.",
      "Toss with pasta; transfer to a dish.",
      "Mix panko with 1 tbsp melted butter and garlic; top; bake 18–20 min until golden."
    ]
  },
  {
    id: "chicken-pot-pie", name: "Skillet Chicken Pot Pie",
    cuisine: "American", minutes: 50,
    ingredients: [
      { name: "carrots, diced", qty: 2, unit: "medium", category: "Produce", discrete: true },
      { name: "celery, diced", qty: 2, unit: "stalk", category: "Produce", discrete: true },
      { name: "garlic, minced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "frozen peas", qty: 1, unit: "cup", category: "Produce", discrete: false },
      { name: "cooked chicken, shredded", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "puff pastry sheet", qty: 1, unit: "whole", category: "Pantry", discrete: true },
      { name: "butter", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "all-purpose flour", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "chicken broth", qty: 1.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "milk", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 400°F. Cook carrots, celery, garlic in butter 5 min.",
      "Stir in flour 1 min; add broth and milk; simmer to thicken.",
      "Fold in chicken, peas, salt; transfer to an oven-safe skillet.",
      "Top with puff pastry, cut vents; bake 22–25 min until golden."
    ]
  },
  {
    id: "sloppy-joes", name: "Garlic Sloppy Joes with Bell Pepper",
    cuisine: "American", minutes: 30,
    ingredients: [
      { name: "red bell pepper, diced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "ground beef", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "hamburger buns", qty: 4, unit: "whole", category: "Pantry", discrete: true },
      { name: "tomato sauce", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "ketchup", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "Worcestershire (anchovy-free)", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Brown beef in oil 6 min; add bell pepper and garlic 3 min.",
      "Stir in paste, tomato sauce, ketchup, brown sugar, Worcestershire, paprika.",
      "Simmer 10 min until thick; spoon onto toasted buns."
    ]
  },
  // ---------------------------------------------------------------- Tex-Mex / Mexican
  {
    id: "fajita-bowls", name: "Sheet-Pan Chili-Lime Chicken Fajita Bowls",
    cuisine: "Tex-Mex", minutes: 30,
    ingredients: [
      { name: "red bell pepper", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "yellow bell pepper", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "zucchini", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "avocado", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "chicken thighs, sliced", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "chili powder", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 425°F. Cook rice.",
      "Whisk oil, garlic, cumin, paprika, chili powder, salt, lime zest + half the juice.",
      "Toss chicken, peppers, zucchini; roast on a sheet pan 20–22 min to 165°F.",
      "Build bowls over rice; top with avocado and remaining lime."
    ]
  },
  {
    id: "enchiladas", name: "Beef & Black Bean Enchiladas with Red Chili Sauce",
    cuisine: "Mexican", minutes: 45,
    ingredients: [
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 2, unit: "tbsp", category: "Produce", discrete: false },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "ground beef", qty: 10, unit: "oz", category: "Proteins", discrete: false },
      { name: "black beans (canned)", qty: 0.75, unit: "cup", category: "Proteins", discrete: false },
      { name: "corn tortillas", qty: 6, unit: "whole", category: "Pantry", discrete: true },
      { name: "crushed tomatoes", qty: 1.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "chili powder", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "shredded cheese", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "vegetable broth", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 375°F. Toast garlic, paste, spices in oil 1 min; add tomatoes, broth, salt; simmer 10 min.",
      "Brown beef 6–7 min; stir in beans and ⅓ cup sauce.",
      "Fill warmed tortillas with beef and cheese; roll seam-down in a dish.",
      "Top with sauce and cheese; bake 18–20 min. Finish with cilantro and lime."
    ]
  },
  {
    id: "beef-tacos", name: "Spiced Beef Tacos with Cabbage-Lime Slaw",
    cuisine: "Tex-Mex", minutes: 30,
    ingredients: [
      { name: "green cabbage, shredded", qty: 2, unit: "cup", category: "Produce", discrete: false },
      { name: "garlic, minced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 3, unit: "tbsp", category: "Produce", discrete: false },
      { name: "avocado", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "ground beef", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "corn tortillas", qty: 6, unit: "whole", category: "Pantry", discrete: true },
      { name: "ground cumin", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "chili powder", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "tomato paste", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Brown beef in oil 6 min; add garlic, cumin, chili powder, paprika, paste, salt + ¼ cup water; simmer 5 min.",
      "Slaw: cabbage, cilantro, lime juice, pinch salt.",
      "Warm tortillas; fill with beef, slaw, avocado. Squeeze lime."
    ]
  },
  {
    id: "chicken-quesadillas", name: "Green-Chile Chicken Quesadillas",
    cuisine: "Mexican", minutes: 30,
    ingredients: [
      { name: "garlic, minced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 2, unit: "tbsp", category: "Produce", discrete: false },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "avocado", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "cooked shredded chicken", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "flour tortillas (large)", qty: 4, unit: "whole", category: "Pantry", discrete: true },
      { name: "canned diced green chiles", qty: 4, unit: "oz can", category: "Pantry", discrete: true },
      { name: "shredded cheese", qty: 1.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "sour cream", qty: 0.25, unit: "cup", category: "Pantry", discrete: false }
    ],
    steps: [
      "Toss chicken with green chiles, garlic, cumin.",
      "Fill tortillas with chicken and cheese; fold.",
      "Cook in oiled skillet 2–3 min per side until golden.",
      "Slice; serve with avocado, sour cream, cilantro, lime."
    ]
  },
  {
    id: "chicken-tinga", name: "Chipotle Chicken Tinga Tostadas",
    cuisine: "Mexican", minutes: 35,
    ingredients: [
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 2, unit: "tbsp", category: "Produce", discrete: false },
      { name: "cooked shredded chicken", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "tostada shells", qty: 6, unit: "whole", category: "Pantry", discrete: true },
      { name: "fire-roasted tomatoes", qty: 14.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "chipotle in adobo", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "refried beans", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "queso fresco, crumbled", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Blend tomatoes, chipotle, garlic, cumin into a sauce.",
      "Simmer sauce in oil 5 min; add chicken, cook 5 min to coat.",
      "Warm refried beans; spread on tostadas.",
      "Top with tinga, queso fresco, cilantro, lime."
    ]
  },
  {
    id: "burrito-bowls", name: "Beef Burrito Bowls with Cilantro-Lime Rice",
    cuisine: "Tex-Mex", minutes: 35,
    ingredients: [
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "lime", qty: 2, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 0.25, unit: "cup", category: "Produce", discrete: false },
      { name: "avocado", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "ground beef", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "black beans", qty: 1, unit: "cup", category: "Proteins", discrete: false },
      { name: "white rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "corn kernels", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "chili powder", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "shredded cheese", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook rice; fold in cilantro and juice of 1 lime.",
      "Brown beef in oil with garlic, cumin, chili powder 7 min.",
      "Warm beans and corn.",
      "Build bowls: rice, beef, beans, corn, cheese, avocado, lime."
    ]
  },
  {
    id: "baked-tacos", name: "Cheesy Bean & Beef Baked Tacos",
    cuisine: "Tex-Mex", minutes: 35,
    ingredients: [
      { name: "garlic, minced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 2, unit: "tbsp", category: "Produce", discrete: false },
      { name: "ground beef", qty: 10, unit: "oz", category: "Proteins", discrete: false },
      { name: "refried beans", qty: 1, unit: "cup", category: "Proteins", discrete: false },
      { name: "hard taco shells", qty: 8, unit: "whole", category: "Pantry", discrete: true },
      { name: "shredded cheese", qty: 1.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "tomato sauce", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "chili powder", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 400°F. Brown beef in oil with garlic, cumin, chili powder; stir in beans and tomato sauce.",
      "Stand taco shells in a baking dish; fill with the mixture.",
      "Top with cheese; bake 12–15 min until melted.",
      "Finish with cilantro and toppings of choice."
    ]
  },
  {
    id: "carne-asada", name: "Garlic-Lime Carne Asada with Charred Peppers",
    cuisine: "Mexican", minutes: 40,
    ingredients: [
      { name: "garlic, minced", qty: 4, unit: "clove", category: "Produce", discrete: true },
      { name: "lime", qty: 2, unit: "whole", category: "Produce", discrete: true },
      { name: "orange", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "bell peppers, sliced", qty: 2, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 0.25, unit: "cup", category: "Produce", discrete: false },
      { name: "flank or skirt steak", qty: 1, unit: "lb", category: "Proteins", discrete: false },
      { name: "corn tortillas", qty: 6, unit: "whole", category: "Pantry", discrete: true },
      { name: "ground cumin", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 1, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Marinate steak 20+ min in garlic, lime + orange juice, cumin, 2 tbsp oil, salt, half the cilantro.",
      "Char peppers in 1 tbsp oil over high until blistered.",
      "Sear steak 3–4 min per side to 130°F; rest 5 min, slice against the grain.",
      "Serve in warm tortillas with peppers, cilantro, lime."
    ]
  },
  {
    id: "enchilada-skillet", name: "Verde Chicken Enchilada Skillet",
    cuisine: "Mexican", minutes: 35,
    ingredients: [
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 3, unit: "tbsp", category: "Produce", discrete: false },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "cooked shredded chicken", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "corn tortillas, cut in strips", qty: 6, unit: "whole", category: "Pantry", discrete: true },
      { name: "salsa verde (tomatillo)", qty: 1.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "black beans", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "shredded cheese", qty: 1.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 400°F. Soften garlic + cumin in oil 1 min in an oven-safe skillet.",
      "Add salsa verde, chicken, beans, and tortilla strips; toss 3 min.",
      "Top with cheese; bake 12–15 min until bubbly.",
      "Finish with cilantro and lime."
    ]
  },
  {
    id: "loaded-nachos", name: "Loaded Beef Sheet-Pan Nachos",
    cuisine: "Tex-Mex", minutes: 30,
    ingredients: [
      { name: "garlic, minced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "tomato, diced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "jalapeño, sliced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "avocado", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "ground beef", qty: 10, unit: "oz", category: "Proteins", discrete: false },
      { name: "tortilla chips", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "black beans", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "shredded cheese", qty: 2, unit: "cup", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "chili powder", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "sour cream", qty: 0.25, unit: "cup", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 400°F. Brown beef with garlic, cumin, chili powder.",
      "Spread chips on a sheet pan; scatter beef, beans, cheese.",
      "Bake 8–10 min until cheese melts.",
      "Top with tomato, jalapeño, avocado, sour cream."
    ]
  },
  {
    id: "carnitas-tacos", name: "Crispy Pork Carnitas Tacos",
    cuisine: "Mexican", minutes: 60,
    ingredients: [
      { name: "garlic", qty: 5, unit: "clove", category: "Produce", discrete: true },
      { name: "orange", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "lime", qty: 2, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 0.25, unit: "cup", category: "Produce", discrete: false },
      { name: "pork shoulder, cubed", qty: 1.25, unit: "lb", category: "Proteins", discrete: false },
      { name: "corn tortillas", qty: 8, unit: "whole", category: "Pantry", discrete: true },
      { name: "ground cumin", qty: 2, unit: "tsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 1.25, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Simmer pork with garlic, orange + lime juice, cumin, oregano, salt and water to cover 45 min until tender.",
      "Boil off liquid, then crisp pork in its own fat + 1 tbsp oil until edges brown.",
      "Warm tortillas.",
      "Fill with carnitas, cilantro, lime."
    ]
  },
  {
    id: "sweet-potato-quesadillas", name: "Black Bean & Sweet Potato Quesadillas",
    cuisine: "Tex-Mex", minutes: 35,
    ingredients: [
      { name: "sweet potato, diced", qty: 1, unit: "large", category: "Produce", discrete: true },
      { name: "garlic, minced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 2, unit: "tbsp", category: "Produce", discrete: false },
      { name: "black beans", qty: 1, unit: "cup", category: "Proteins", discrete: false },
      { name: "flour tortillas (large)", qty: 4, unit: "whole", category: "Pantry", discrete: true },
      { name: "shredded cheese", qty: 1.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Roast sweet potato with 1 tbsp oil, cumin, paprika, salt at 425°F for 20 min.",
      "Mash lightly with beans, garlic, lime juice, cilantro.",
      "Fill tortillas with mixture and cheese; fold.",
      "Crisp in oiled skillet 2–3 min per side."
    ]
  },
  {
    id: "taco-sweet-potatoes", name: "Taco-Stuffed Sweet Potatoes",
    cuisine: "Tex-Mex", minutes: 50,
    ingredients: [
      { name: "sweet potatoes", qty: 2, unit: "large", category: "Produce", discrete: true },
      { name: "garlic, minced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "avocado", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "ground beef or turkey", qty: 10, unit: "oz", category: "Proteins", discrete: false },
      { name: "black beans", qty: 0.75, unit: "cup", category: "Proteins", discrete: false },
      { name: "shredded cheese", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "chili powder", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Bake pierced sweet potatoes at 425°F for 40–45 min until soft.",
      "Brown meat in oil with garlic, cumin, chili powder; stir in beans.",
      "Split potatoes; fluff and fill with taco mixture and cheese.",
      "Top with avocado and lime."
    ]
  },
  // ---------------------------------------------------------------- Thai
  {
    id: "pad-krapow", name: "Thai Basil Chicken (Pad Krapow) over Jasmine Rice",
    cuisine: "Thai", minutes: 25,
    ingredients: [
      { name: "Thai basil leaves", qty: 1, unit: "cup", category: "Produce", discrete: false },
      { name: "garlic, minced", qty: 4, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh ginger, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "Thai chili, minced", qty: 1.5, unit: "whole", category: "Produce", discrete: true },
      { name: "red bell pepper, diced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "ground chicken", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "eggs", qty: 2, unit: "whole", category: "Proteins", discrete: true },
      { name: "jasmine rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "coconut aminos", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook jasmine rice.",
      "Stir-fry garlic, ginger, chili in 1 tbsp oil over high 30 sec.",
      "Add chicken; stir-fry 5–6 min. Add bell pepper 2 min; add soy, aminos, sugar 1 min; fold in basil off heat.",
      "Fry eggs crispy in remaining oil; serve chicken over rice, topped with an egg."
    ]
  },
  {
    id: "coconut-curry", name: "Thai Coconut Chicken Curry with Potatoes",
    cuisine: "Thai", minutes: 40,
    ingredients: [
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh ginger, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "lemongrass, minced", qty: 1, unit: "stalk", category: "Produce", discrete: true },
      { name: "Yukon Gold potatoes, cubed", qty: 2, unit: "medium", category: "Produce", discrete: true },
      { name: "red bell pepper, sliced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "chicken thighs, cubed", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "jasmine rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "full-fat coconut milk", qty: 13.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "red curry powder", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "ground turmeric", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook jasmine rice.",
      "Bloom garlic, ginger, lemongrass in oil 1 min; add curry powder, turmeric 30 sec.",
      "Brown chicken 4–5 min; add coconut milk, soy; add potatoes, simmer covered 15 min.",
      "Add pepper, simmer 8–10 min to 165°F; finish with lime. Serve over rice."
    ]
  },
  {
    id: "thai-peanut-noodles", name: "Thai Peanut Noodles with Chicken",
    cuisine: "Thai", minutes: 30,
    ingredients: [
      { name: "garlic, minced", qty: 2, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh ginger, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "carrot, julienned", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "red bell pepper, sliced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "chicken breast, sliced", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "rice noodles", qty: 6, unit: "oz", category: "Pantry", discrete: false },
      { name: "creamy peanut butter", qty: 0.25, unit: "cup", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "rice vinegar", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook rice noodles; drain.",
      "Whisk peanut butter, soy, brown sugar, vinegar, lime juice, 3 tbsp warm water.",
      "Stir-fry garlic + ginger in oil 30 sec; add chicken 5–6 min; add carrot and pepper 2 min.",
      "Add noodles and sauce; toss. Top with crushed peanuts."
    ]
  },
  {
    id: "thai-basil-beef", name: "Ginger-Lemongrass Thai Basil Beef Bowls",
    cuisine: "Thai", minutes: 25,
    ingredients: [
      { name: "Thai basil leaves", qty: 1, unit: "cup", category: "Produce", discrete: false },
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh ginger, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "lemongrass, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "green beans, cut", qty: 6, unit: "oz", category: "Produce", discrete: false },
      { name: "ground beef", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "jasmine rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "coconut aminos", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook jasmine rice.",
      "Stir-fry garlic, ginger, lemongrass in oil 30 sec.",
      "Add beef; brown 6 min. Add green beans 3 min.",
      "Add soy, aminos, sugar; toss 1 min. Fold in basil off heat; serve over rice."
    ]
  },
  {
    id: "thai-red-curry", name: "Thai Red Curry Chicken",
    cuisine: "Thai", minutes: 35,
    ingredients: [
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh ginger, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "red bell pepper, sliced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "Thai basil leaves", qty: 0.5, unit: "cup", category: "Produce", discrete: false },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "chicken thighs, sliced", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "jasmine rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "full-fat coconut milk", qty: 13.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "Thai red curry paste (shrimp-free)", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook jasmine rice.",
      "Fry curry paste, garlic, ginger in oil 1 min; add ¼ cup coconut milk, reduce 2 min.",
      "Add chicken 4 min; add remaining coconut milk, soy, sugar; simmer 8 min.",
      "Add pepper 3 min; finish with basil and lime. Serve over rice."
    ]
  },
  {
    id: "thai-green-curry", name: "Thai Green Curry with Chicken",
    cuisine: "Thai", minutes: 35,
    ingredients: [
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh ginger, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "zucchini, sliced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "Thai basil leaves", qty: 0.5, unit: "cup", category: "Produce", discrete: false },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "chicken thighs, sliced", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "jasmine rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "full-fat coconut milk", qty: 13.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "Thai green curry paste (shrimp-free)", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook jasmine rice.",
      "Fry green curry paste, garlic, ginger in oil 1 min; add ¼ cup coconut milk, reduce 2 min.",
      "Add chicken 4 min; add remaining coconut milk, soy, sugar; simmer 8 min.",
      "Add zucchini 4 min; finish with basil and lime. Serve over rice."
    ]
  },
  {
    id: "pad-see-ew", name: "Pad See Ew (Stir-Fried Soy Noodles)",
    cuisine: "Thai", minutes: 25,
    ingredients: [
      { name: "garlic, minced", qty: 4, unit: "clove", category: "Produce", discrete: true },
      { name: "Chinese broccoli or broccolini", qty: 3, unit: "cup", category: "Produce", discrete: false },
      { name: "chicken breast, sliced", qty: 10, unit: "oz", category: "Proteins", discrete: false },
      { name: "eggs", qty: 2, unit: "whole", category: "Proteins", discrete: true },
      { name: "wide rice noodles", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "dark soy sauce", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "oyster-free stir-fry sauce", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Soften wide rice noodles per package.",
      "Stir-fry garlic in oil 20 sec; add chicken 4 min; push aside, scramble eggs.",
      "Add broccoli 2 min; add noodles, soy sauces, stir-fry sauce, sugar.",
      "Toss over high heat until charred edges appear."
    ]
  },
  {
    id: "thai-yellow-curry", name: "Thai Yellow Curry with Beef & Potatoes",
    cuisine: "Thai", minutes: 45,
    ingredients: [
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh ginger, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "Yukon Gold potatoes, cubed", qty: 2, unit: "medium", category: "Produce", discrete: true },
      { name: "carrot, sliced", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "beef stew meat, cubed", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "jasmine rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "full-fat coconut milk", qty: 13.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "yellow curry powder", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "ground turmeric", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook jasmine rice.",
      "Bloom garlic, ginger, curry powder, turmeric in oil 1 min.",
      "Brown beef 5 min; add coconut milk, soy, 1 cup water; simmer covered 25 min.",
      "Add potatoes and carrot; simmer 20 min until tender. Finish with lime; serve over rice."
    ]
  },
  {
    id: "drunken-noodles", name: "Thai Drunken Noodles (Pad Kee Mao)",
    cuisine: "Thai", minutes: 30,
    ingredients: [
      { name: "garlic, minced", qty: 4, unit: "clove", category: "Produce", discrete: true },
      { name: "Thai chili, minced", qty: 2, unit: "whole", category: "Produce", discrete: true },
      { name: "Thai basil leaves", qty: 1, unit: "cup", category: "Produce", discrete: false },
      { name: "red bell pepper, sliced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "ground chicken", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "wide rice noodles", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "dark soy sauce", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "oyster-free stir-fry sauce", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Soften wide rice noodles.",
      "Stir-fry garlic and chili in oil 20 sec; add chicken 5 min.",
      "Add bell pepper 2 min; add noodles, soy sauces, stir-fry sauce, sugar.",
      "Toss over high heat; fold in basil off heat."
    ]
  },
  {
    id: "cashew-chicken", name: "Thai Cashew Chicken",
    cuisine: "Thai", minutes: 30,
    ingredients: [
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh ginger, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "red bell pepper, diced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "dried red chilies", qty: 3, unit: "whole", category: "Produce", discrete: true },
      { name: "chicken thighs, diced", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "roasted cashews", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "jasmine rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "oyster-free stir-fry sauce", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "cornstarch", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook jasmine rice. Toss chicken with cornstarch.",
      "Stir-fry garlic, ginger, dried chilies in oil 30 sec; add chicken 6 min.",
      "Add bell pepper 2 min; add soy, stir-fry sauce, sugar + 2 tbsp water; toss to glaze.",
      "Fold in cashews; serve over rice."
    ]
  },
  {
    id: "massaman-beef", name: "Massaman-Style Beef Curry",
    cuisine: "Thai", minutes: 60,
    ingredients: [
      { name: "garlic, minced", qty: 4, unit: "clove", category: "Produce", discrete: true },
      { name: "fresh ginger, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "Yukon Gold potatoes, cubed", qty: 2, unit: "medium", category: "Produce", discrete: true },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "beef chuck, cubed", qty: 14, unit: "oz", category: "Proteins", discrete: false },
      { name: "roasted peanuts", qty: 0.333, unit: "cup", category: "Proteins", discrete: false },
      { name: "jasmine rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "full-fat coconut milk", qty: 13.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "massaman curry powder", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "ground cinnamon", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Bloom garlic, ginger, curry powder, cinnamon in oil 1 min; brown beef 5 min.",
      "Add coconut milk, soy, brown sugar, 1 cup water; simmer covered 35 min.",
      "Add potatoes and peanuts; simmer 20 min until beef is tender.",
      "Finish with lime; serve over jasmine rice."
    ]
  },
  {
    id: "thai-fried-rice", name: "Thai Basil Fried Rice with Egg",
    cuisine: "Thai", minutes: 20,
    ingredients: [
      { name: "garlic, minced", qty: 3, unit: "clove", category: "Produce", discrete: true },
      { name: "Thai basil leaves", qty: 0.75, unit: "cup", category: "Produce", discrete: false },
      { name: "carrot, diced", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "tomato, diced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "eggs", qty: 3, unit: "whole", category: "Proteins", discrete: true },
      { name: "cooked jasmine rice (cold)", qty: 3, unit: "cup", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "oyster-free stir-fry sauce", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oil over high; stir-fry garlic 20 sec, add carrot 2 min.",
      "Push aside; scramble eggs.",
      "Add cold rice, soy, stir-fry sauce; toss 3 min until hot and slightly crisp.",
      "Fold in tomato and basil; serve with lime wedges."
    ]
  }
];

if (typeof module !== "undefined") module.exports = { MEALS };
